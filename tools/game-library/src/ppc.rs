use std::{collections::BTreeMap, fs, path::Path};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_ELF_BYTES: usize = 128 * 1024 * 1024;
const MAX_SECTIONS: usize = 4_096;
const MAX_CALLS: usize = 1_000_000;

#[derive(Clone, Debug, PartialEq)]
pub struct PpcResourceCallOptions {
    pub module: String,
    pub start: Option<u32>,
    pub end: Option<u32>,
    pub sda2_base: Option<u32>,
    pub sda_base: Option<u32>,
    pub apis: Vec<PpcResourceApi>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PpcResourceApi {
    pub kind: String,
    pub address: u32,
    pub name_register: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PpcResourceCallReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub module: String,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub analysis_range: AddressRange,
    pub abi_register_bases: AbiRegisterBases,
    pub apis: Vec<PpcResourceApiReport>,
    pub calls: Vec<PpcResourceCall>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AddressRange {
    pub start: String,
    pub end: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AbiRegisterBases {
    pub r2_sda2: Option<String>,
    pub r13_sda: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PpcResourceApiReport {
    pub kind: String,
    pub address: String,
    pub name_register: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PpcResourceCall {
    pub kind: String,
    pub call_address: String,
    pub resource_address: Option<String>,
    pub resource_name: Option<String>,
}

#[derive(Clone, Debug)]
struct ElfSection {
    name: String,
    address: u32,
    offset: usize,
    size: usize,
    executable: bool,
    materialized: bool,
}

pub fn inspect_ppc_resource_calls(
    path: &Path,
    options: &PpcResourceCallOptions,
) -> Result<PpcResourceCallReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "ELF input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_ELF_BYTES as u64,
        "ELF input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_ppc_resource_calls(&bytes, options)
}

pub fn parse_ppc_resource_calls(
    bytes: &[u8],
    options: &PpcResourceCallOptions,
) -> Result<PpcResourceCallReport> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_ELF_BYTES,
        "ELF input exceeds the bounded size"
    );
    ensure!(
        !options.module.trim().is_empty(),
        "module must not be empty"
    );
    ensure!(
        !options.apis.is_empty(),
        "at least one resource API is required"
    );
    let sections = parse_elf32_be_sections(bytes)?;
    let api_by_address: BTreeMap<_, _> = options
        .apis
        .iter()
        .map(|api| {
            ensure!(!api.kind.trim().is_empty(), "API kind must not be empty");
            ensure!(
                api.name_register < 32,
                "API register must be r0 through r31"
            );
            Ok((api.address, api))
        })
        .collect::<Result<_>>()?;
    ensure!(
        api_by_address.len() == options.apis.len(),
        "resource API addresses must be unique"
    );

    let code = match options.start {
        Some(start) => sections
            .iter()
            .find(|section| section.executable && contains_address(section, start, 4))
            .context("analysis start is outside an executable section")?,
        None => {
            let module_section = format!(".text:{}", options.module);
            if let Some(section) = sections
                .iter()
                .find(|section| section.executable && section.name == module_section)
            {
                section
            } else {
                let linked_candidates: Vec<_> = sections
                    .iter()
                    .filter(|section| section.executable && section.name.starts_with(".text:"))
                    .collect();
                if linked_candidates.len() == 1 {
                    linked_candidates[0]
                } else {
                    let candidates: Vec<_> = sections
                        .iter()
                        .filter(|section| section.executable && section.name.starts_with(".text"))
                        .collect();
                    ensure!(
                        candidates.len() == 1,
                        "module has no unique executable text section; provide --start and --end"
                    );
                    candidates[0]
                }
            }
        }
    };
    let start = options.start.unwrap_or(code.address);
    let section_end = code
        .address
        .checked_add(u32::try_from(code.size).context("executable section is too large")?)
        .context("executable section address overflow")?;
    let end = options.end.unwrap_or(section_end);
    ensure!(start < end, "analysis range must not be empty");
    ensure!(
        start.is_multiple_of(4) && end.is_multiple_of(4),
        "analysis range must be instruction aligned"
    );
    ensure!(
        end <= section_end,
        "analysis end is outside the selected executable section"
    );

    let mut registers = initial_registers(options);
    let mut calls = Vec::new();
    for address in (start..end).step_by(4) {
        let instruction = read_elf_u32(bytes, code, address)?;
        update_constants(&mut registers, instruction);
        if instruction >> 26 == 18 && instruction & 1 == 1 {
            let encoded = instruction & 0x03ff_fffc;
            let displacement = sign_extend_26(encoded);
            let target = if instruction & 2 == 2 {
                displacement as u32
            } else {
                address.wrapping_add(displacement as u32)
            };
            if let Some(api) = api_by_address.get(&target) {
                ensure!(
                    calls.len() < MAX_CALLS,
                    "resource call count exceeds the limit"
                );
                let resource_address = registers.get(&api.name_register).copied();
                calls.push(PpcResourceCall {
                    kind: api.kind.clone(),
                    call_address: hex_address(address),
                    resource_address: resource_address.map(hex_address),
                    resource_name: resource_address
                        .and_then(|value| read_ascii_c_string(bytes, &sections, value)),
                });
            }
            clear_volatile_registers(&mut registers);
        } else if matches!(instruction >> 26, 16 | 18) {
            clear_volatile_registers(&mut registers);
        }
        if instruction == 0x4e80_0020 {
            registers = initial_registers(options);
        }
    }

    Ok(PpcResourceCallReport {
        format: "orbite.ppc-resource-call-index/1",
        adapter: "powerpc.elf32-be",
        module: options.module.clone(),
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        analysis_range: AddressRange {
            start: hex_address(start),
            end: hex_address(end),
        },
        abi_register_bases: AbiRegisterBases {
            r2_sda2: options.sda2_base.map(hex_address),
            r13_sda: options.sda_base.map(hex_address),
        },
        apis: options
            .apis
            .iter()
            .map(|api| PpcResourceApiReport {
                kind: api.kind.clone(),
                address: hex_address(api.address),
                name_register: api.name_register,
            })
            .collect(),
        calls,
    })
}

fn parse_elf32_be_sections(bytes: &[u8]) -> Result<Vec<ElfSection>> {
    ensure!(bytes.len() >= 52, "truncated ELF32 header");
    ensure!(bytes.get(0..4) == Some(b"\x7fELF"), "invalid ELF magic");
    ensure!(bytes[4] == 1 && bytes[5] == 2, "expected big-endian ELF32");
    ensure!(read_u16(bytes, 18)? == 20, "expected a PowerPC ELF machine");
    let section_offset = read_u32(bytes, 32)? as usize;
    let section_size = read_u16(bytes, 46)? as usize;
    let section_count = read_u16(bytes, 48)? as usize;
    let names_index = read_u16(bytes, 50)? as usize;
    ensure!(section_size >= 40, "invalid ELF section header size");
    ensure!(
        section_count > 0 && section_count <= MAX_SECTIONS,
        "invalid ELF section count"
    );
    ensure!(
        names_index < section_count,
        "invalid ELF section-name table index"
    );
    ensure_span(
        bytes,
        section_offset,
        section_count,
        section_size,
        "ELF section headers",
    )?;
    let names_header = section_offset + names_index * section_size;
    let names_offset = read_u32(bytes, names_header + 16)? as usize;
    let names_size = read_u32(bytes, names_header + 20)? as usize;
    ensure_span(bytes, names_offset, 1, names_size, "ELF section-name table")?;
    let names = &bytes[names_offset..names_offset + names_size];
    let mut sections = Vec::with_capacity(section_count);
    for index in 0..section_count {
        let header = section_offset + index * section_size;
        let name_offset = read_u32(bytes, header)? as usize;
        let section_type = read_u32(bytes, header + 4)?;
        let flags = read_u32(bytes, header + 8)?;
        let address = read_u32(bytes, header + 12)?;
        let offset = read_u32(bytes, header + 16)? as usize;
        let size = read_u32(bytes, header + 20)? as usize;
        let name = read_table_string(names, name_offset).context("invalid ELF section name")?;
        if section_type != 8 {
            ensure_span(bytes, offset, 1, size, "ELF section")?;
        }
        sections.push(ElfSection {
            name,
            address,
            offset,
            size,
            executable: flags & 4 != 0,
            materialized: section_type != 8,
        });
    }
    Ok(sections)
}

fn update_constants(registers: &mut BTreeMap<u8, u32>, instruction: u32) {
    let opcode = instruction >> 26;
    let target = ((instruction >> 21) & 31) as u8;
    let base = ((instruction >> 16) & 31) as u8;
    let immediate = instruction as u16;
    let signed = i32::from(immediate as i16);
    match opcode {
        15 => set_from_base(registers, target, base, signed.wrapping_shl(16)),
        14 => set_from_base(registers, target, base, signed),
        24 => {
            let value = registers
                .get(&target)
                .copied()
                .map(|value| value | u32::from(immediate));
            set_or_remove(registers, base, value);
        }
        31 if (instruction >> 1) & 0x3ff == 444 => {
            let other = ((instruction >> 11) & 31) as u8;
            let value = (target == other)
                .then(|| registers.get(&target).copied())
                .flatten();
            set_or_remove(registers, base, value);
        }
        7 | 8 | 12 | 13 | 32..=35 | 40..=43 => {
            registers.remove(&target);
        }
        20 | 21 | 23 | 25..=29 => {
            registers.remove(&base);
        }
        31 => {
            registers.remove(&target);
            registers.remove(&base);
        }
        _ => {}
    }
}

fn set_from_base(registers: &mut BTreeMap<u8, u32>, target: u8, base: u8, addend: i32) {
    let value = if base == 0 {
        Some(addend as u32)
    } else {
        registers
            .get(&base)
            .copied()
            .map(|value| value.wrapping_add(addend as u32))
    };
    set_or_remove(registers, target, value);
}

fn set_or_remove(registers: &mut BTreeMap<u8, u32>, register: u8, value: Option<u32>) {
    if let Some(value) = value {
        registers.insert(register, value);
    } else {
        registers.remove(&register);
    }
}

fn initial_registers(options: &PpcResourceCallOptions) -> BTreeMap<u8, u32> {
    let mut registers = BTreeMap::new();
    if let Some(value) = options.sda2_base {
        registers.insert(2, value);
    }
    if let Some(value) = options.sda_base {
        registers.insert(13, value);
    }
    registers
}

fn clear_volatile_registers(registers: &mut BTreeMap<u8, u32>) {
    registers.remove(&0);
    for register in 3..=12 {
        registers.remove(&register);
    }
}

fn contains_address(section: &ElfSection, address: u32, bytes: usize) -> bool {
    let Some(relative) = address.checked_sub(section.address) else {
        return false;
    };
    usize::try_from(relative)
        .ok()
        .and_then(|relative| relative.checked_add(bytes))
        .is_some_and(|end| end <= section.size)
}

fn read_elf_u32(bytes: &[u8], section: &ElfSection, address: u32) -> Result<u32> {
    let relative = usize::try_from(address - section.address)?;
    read_u32(bytes, section.offset + relative)
}

fn read_ascii_c_string(bytes: &[u8], sections: &[ElfSection], address: u32) -> Option<String> {
    let section = sections
        .iter()
        .find(|section| section.materialized && contains_address(section, address, 1))?;
    let start = section
        .offset
        .checked_add(usize::try_from(address - section.address).ok()?)?;
    let available = section
        .size
        .checked_sub(usize::try_from(address - section.address).ok()?)?;
    let bounded = bytes.get(start..start.checked_add(available.min(128))?)?;
    let end = bounded.iter().position(|byte| *byte == 0)?;
    let value = bounded.get(..end)?;
    (!value.is_empty() && value.iter().all(u8::is_ascii_graphic))
        .then(|| String::from_utf8(value.to_vec()).ok())
        .flatten()
}

fn read_table_string(bytes: &[u8], offset: usize) -> Option<String> {
    let tail = bytes.get(offset..)?;
    let end = tail.iter().position(|byte| *byte == 0)?;
    String::from_utf8(tail.get(..end)?.to_vec()).ok()
}

fn sign_extend_26(value: u32) -> i32 {
    ((value << 6) as i32) >> 6
}

fn hex_address(value: u32) -> String {
    format!("0x{value:08x}")
}

fn ensure_span(
    bytes: &[u8],
    offset: usize,
    count: usize,
    stride: usize,
    label: &str,
) -> Result<()> {
    let size = count.checked_mul(stride).context("span overflow")?;
    let end = offset.checked_add(size).context("span overflow")?;
    ensure!(end <= bytes.len(), "truncated {label}");
    Ok(())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(
        bytes
            .get(offset..offset + 2)
            .context("truncated u16")?
            .try_into()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        bytes
            .get(offset..offset + 4)
            .context("truncated u32")?
            .try_into()?,
    ))
}

pub fn parse_hex_u32(value: &str) -> Result<u32> {
    let value = value.strip_prefix("0x").unwrap_or(value);
    u32::from_str_radix(value, 16).with_context(|| format!("invalid hexadecimal address {value}"))
}

pub fn parse_api(value: &str) -> Result<PpcResourceApi> {
    let (kind, tail) = value
        .split_once('=')
        .context("API must use KIND=ADDRESS:rN")?;
    let (address, register) = tail
        .rsplit_once(':')
        .context("API must use KIND=ADDRESS:rN")?;
    let register = register
        .strip_prefix('r')
        .context("API register must use rN")?;
    let name_register: u8 = register.parse().context("invalid API register")?;
    ensure!(name_register < 32, "API register must be r0 through r31");
    ensure!(!kind.trim().is_empty(), "API kind must not be empty");
    Ok(PpcResourceApi {
        kind: kind.to_owned(),
        address: parse_hex_u32(address)?,
        name_register,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_elf() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0x240];
        bytes[0..4].copy_from_slice(b"\x7fELF");
        bytes[4] = 1;
        bytes[5] = 2;
        bytes[18..20].copy_from_slice(&20_u16.to_be_bytes());
        bytes[32..36].copy_from_slice(&0x180_u32.to_be_bytes());
        bytes[46..48].copy_from_slice(&40_u16.to_be_bytes());
        bytes[48..50].copy_from_slice(&4_u16.to_be_bytes());
        bytes[50..52].copy_from_slice(&3_u16.to_be_bytes());
        bytes[0x160..0x179].copy_from_slice(b"\0.text\0.rodata\0.shstrtab\0");
        write_section(&mut bytes, 0x1a8, [1, 1, 4, 0x1000, 0x100, 16]);
        write_section(&mut bytes, 0x1d0, [7, 1, 0, 0x2000, 0x140, 7]);
        write_section(&mut bytes, 0x1f8, [15, 3, 0, 0, 0x160, 25]);
        bytes[0x140..0x147].copy_from_slice(b"Search\0");
        for (offset, instruction) in [
            (0x100, 0x3862_f000_u32),
            (0x104, 0x3c80_0000_u32),
            (0x108, 0x3884_3000_u32),
            (0x10c, 0x4800_0ff5_u32),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&instruction.to_be_bytes());
        }
        bytes
    }

    fn write_section(bytes: &mut [u8], offset: usize, fields: [u32; 6]) {
        let [name, section_type, flags, address, file_offset, size] = fields;
        for (at, value) in [
            (0, name),
            (4, section_type),
            (8, flags),
            (12, address),
            (16, file_offset),
            (20, size),
        ] {
            bytes[offset + at..offset + at + 4].copy_from_slice(&value.to_be_bytes());
        }
    }

    fn options() -> PpcResourceCallOptions {
        PpcResourceCallOptions {
            module: "fixture".into(),
            start: Some(0x1000),
            end: Some(0x1010),
            sda2_base: Some(0x3000),
            sda_base: None,
            apis: vec![PpcResourceApi {
                kind: "resource.load".into(),
                address: 0x2000,
                name_register: 3,
            }],
        }
    }

    #[test]
    fn resolves_a_bounded_sda_resource_call() {
        let report = parse_ppc_resource_calls(&fixture_elf(), &options()).unwrap();
        assert_eq!(report.calls.len(), 1);
        assert_eq!(
            report.calls[0].resource_address.as_deref(),
            Some("0x00002000")
        );
        assert_eq!(report.calls[0].resource_name.as_deref(), Some("Search"));
    }

    #[test]
    fn rejects_wrong_endianness_and_out_of_range_analysis() {
        let mut bytes = fixture_elf();
        bytes[5] = 1;
        assert!(parse_ppc_resource_calls(&bytes, &options()).is_err());
        let mut invalid = options();
        invalid.end = Some(0x1020);
        assert!(parse_ppc_resource_calls(&fixture_elf(), &invalid).is_err());
    }

    #[test]
    fn parses_typed_api_arguments() {
        assert_eq!(
            parse_api("resource.load=0x80057170:r4").unwrap(),
            PpcResourceApi {
                kind: "resource.load".into(),
                address: 0x8005_7170,
                name_register: 4,
            }
        );
        assert!(parse_api("resource.load:80057170:4").is_err());
    }
}
