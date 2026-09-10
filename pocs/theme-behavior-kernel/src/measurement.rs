use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const MINIMUM_PASSES: u32 = 5;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scenario {
    NativeDesktop,
    Static,
    Active,
    Interaction,
    Pause,
    Occlusion,
    Resume,
    MultiDisplay,
}

impl Scenario {
    pub const ALL: [Self; 8] = [
        Self::NativeDesktop,
        Self::Static,
        Self::Active,
        Self::Interaction,
        Self::Pause,
        Self::Occlusion,
        Self::Resume,
        Self::MultiDisplay,
    ];
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MachineContext {
    pub model: String,
    pub chip: String,
    pub memory_bytes: u64,
    pub os_version: String,
    pub os_build: String,
    pub display_count: u32,
    pub display_mode: String,
    pub refresh_hz: u32,
    pub power_source: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MetricValues {
    pub energy_joules: Option<f64>,
    pub average_watts: Option<f64>,
    pub cpu_percent: Option<f64>,
    pub gpu_percent: Option<f64>,
    pub wakeups_per_second: Option<f64>,
    pub memory_bytes: Option<f64>,
    pub frame_time_ms: Option<f64>,
    pub gpu_submissions: Option<f64>,
    pub input_to_image_ms: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MeasurementSample {
    pub pass: u32,
    pub order: u32,
    pub scenario: Scenario,
    pub duration_seconds: f64,
    pub metrics: MetricValues,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MeasurementInput {
    pub schema_version: u32,
    pub machine: MachineContext,
    pub warmup_seconds: u64,
    pub package_sha256: String,
    pub instrument: String,
    pub counter_scope: String,
    pub samples: Vec<MeasurementSample>,
    pub disturbances: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Statistic {
    pub observed_samples: usize,
    pub mean: f64,
    pub median: f64,
    pub standard_deviation: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MetricStatistics {
    pub duration_seconds: Option<Statistic>,
    pub energy_joules: Option<Statistic>,
    pub average_watts: Option<Statistic>,
    pub cpu_percent: Option<Statistic>,
    pub gpu_percent: Option<Statistic>,
    pub wakeups_per_second: Option<Statistic>,
    pub memory_bytes: Option<Statistic>,
    pub frame_time_ms: Option<Statistic>,
    pub gpu_submissions: Option<Statistic>,
    pub input_to_image_ms: Option<Statistic>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ScenarioSummary {
    pub scenario: Scenario,
    pub pass_count: usize,
    pub statistics: MetricStatistics,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QualificationStatus {
    Complete,
    NonConclusive,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MeasurementReceipt {
    pub schema_version: u32,
    pub status: QualificationStatus,
    pub machine: MachineContext,
    pub warmup_seconds: u64,
    pub package_sha256: String,
    pub binary_sha256: String,
    pub instrument: String,
    pub counter_scope: String,
    pub pass_count: u32,
    pub samples: Vec<MeasurementSample>,
    pub summaries: Vec<ScenarioSummary>,
    pub disturbances: Vec<String>,
    pub limitations: Vec<String>,
}

pub fn build_receipt(
    input: MeasurementInput,
    binary_sha256: String,
) -> Result<MeasurementReceipt, String> {
    validate_text(&input.machine.model, "machine model")?;
    validate_text(&input.machine.chip, "machine chip")?;
    validate_text(&input.machine.os_version, "OS version")?;
    validate_text(&input.machine.os_build, "OS build")?;
    validate_text(&input.machine.display_mode, "display mode")?;
    validate_text(&input.machine.power_source, "power source")?;
    validate_text(&input.instrument, "instrument")?;
    validate_text(&input.counter_scope, "counter scope")?;
    validate_sha256(&input.package_sha256, "package SHA-256")?;
    validate_sha256(&binary_sha256, "binary SHA-256")?;
    if input.schema_version != 1 {
        return Err("measurement input schema_version must be 1".into());
    }
    if input.warmup_seconds == 0 {
        return Err("measurement warmup must be positive".into());
    }
    if input.machine.memory_bytes == 0
        || input.machine.display_count == 0
        || input.machine.refresh_hz == 0
    {
        return Err("machine memory and display values must be positive".into());
    }

    let pass_count = input
        .samples
        .iter()
        .map(|sample| sample.pass)
        .max()
        .unwrap_or(0);
    if pass_count < MINIMUM_PASSES {
        return Err("measurement requires at least five passes".into());
    }
    validate_alternating_samples(&input.samples, pass_count)?;

    let mut summaries = Vec::with_capacity(Scenario::ALL.len());
    let mut missing_metrics = BTreeSet::new();
    for scenario in Scenario::ALL {
        let samples: Vec<_> = input
            .samples
            .iter()
            .filter(|sample| sample.scenario == scenario)
            .collect();
        let statistics = summarize(&samples);
        record_missing_metrics(scenario, &statistics, &mut missing_metrics);
        summaries.push(ScenarioSummary {
            scenario,
            pass_count: samples.len(),
            statistics,
        });
    }
    let limitations = missing_metrics
        .into_iter()
        .map(|metric| format!("{metric} was not observed in every applicable scenario"))
        .collect::<Vec<_>>();
    let status = if limitations.is_empty() {
        QualificationStatus::Complete
    } else {
        QualificationStatus::NonConclusive
    };

    Ok(MeasurementReceipt {
        schema_version: 1,
        status,
        machine: input.machine,
        warmup_seconds: input.warmup_seconds,
        package_sha256: input.package_sha256,
        binary_sha256,
        instrument: input.instrument,
        counter_scope: input.counter_scope,
        pass_count,
        samples: input.samples,
        summaries,
        disturbances: input.disturbances,
        limitations,
    })
}

fn validate_alternating_samples(
    samples: &[MeasurementSample],
    pass_count: u32,
) -> Result<(), String> {
    for sample in samples {
        if sample.pass == 0
            || sample.order == 0
            || !sample.duration_seconds.is_finite()
            || sample.duration_seconds <= 0.0
        {
            return Err("sample pass, order and duration must be positive".into());
        }
        for value in metric_values(sample) {
            if let Some(value) = value
                && (!value.is_finite() || value < 0.0)
            {
                return Err("observed metrics must be finite and non-negative".into());
            }
        }
        if matches!(sample.scenario, Scenario::Pause | Scenario::Occlusion)
            && sample.metrics.gpu_submissions != Some(0.0)
        {
            return Err("pause and occlusion require zero GPU submissions".into());
        }
    }

    for pass in 1..=pass_count {
        let mut ordered: Vec<_> = samples
            .iter()
            .filter(|sample| sample.pass == pass)
            .collect();
        ordered.sort_by_key(|sample| sample.order);
        if ordered.len() != Scenario::ALL.len() {
            return Err("every pass must contain every scenario exactly once".into());
        }
        let expected: Vec<_> = if pass % 2 == 1 {
            Scenario::ALL.to_vec()
        } else {
            Scenario::ALL.iter().rev().copied().collect()
        };
        for (index, (sample, scenario)) in ordered.iter().zip(expected).enumerate() {
            if sample.order != index as u32 + 1 || sample.scenario != scenario {
                return Err(
                    "scenario order must alternate between forward and reverse passes".into(),
                );
            }
        }
    }
    Ok(())
}

fn summarize(samples: &[&MeasurementSample]) -> MetricStatistics {
    MetricStatistics {
        duration_seconds: statistic(samples.iter().map(|sample| Some(sample.duration_seconds))),
        energy_joules: statistic(samples.iter().map(|sample| sample.metrics.energy_joules)),
        average_watts: statistic(samples.iter().map(|sample| sample.metrics.average_watts)),
        cpu_percent: statistic(samples.iter().map(|sample| sample.metrics.cpu_percent)),
        gpu_percent: statistic(samples.iter().map(|sample| sample.metrics.gpu_percent)),
        wakeups_per_second: statistic(
            samples
                .iter()
                .map(|sample| sample.metrics.wakeups_per_second),
        ),
        memory_bytes: statistic(samples.iter().map(|sample| sample.metrics.memory_bytes)),
        frame_time_ms: statistic(samples.iter().map(|sample| sample.metrics.frame_time_ms)),
        gpu_submissions: statistic(samples.iter().map(|sample| sample.metrics.gpu_submissions)),
        input_to_image_ms: statistic(
            samples
                .iter()
                .map(|sample| sample.metrics.input_to_image_ms),
        ),
    }
}

fn statistic(values: impl Iterator<Item = Option<f64>>) -> Option<Statistic> {
    let mut values: Vec<_> = values.flatten().collect();
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let middle = values.len() / 2;
    let median = if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    };
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    Some(Statistic {
        observed_samples: values.len(),
        mean,
        median,
        standard_deviation: variance.sqrt(),
    })
}

fn record_missing_metrics(
    scenario: Scenario,
    statistics: &MetricStatistics,
    missing: &mut BTreeSet<&'static str>,
) {
    let required = [
        ("energy_joules", &statistics.energy_joules),
        ("average_watts", &statistics.average_watts),
        ("cpu_percent", &statistics.cpu_percent),
        ("gpu_percent", &statistics.gpu_percent),
        ("wakeups_per_second", &statistics.wakeups_per_second),
        ("memory_bytes", &statistics.memory_bytes),
    ];
    for (name, value) in required {
        if value
            .as_ref()
            .is_none_or(|value| value.observed_samples < MINIMUM_PASSES as usize)
        {
            missing.insert(name);
        }
    }
    if scenario != Scenario::NativeDesktop {
        require_metric("gpu_submissions", &statistics.gpu_submissions, missing);
    }
    if matches!(
        scenario,
        Scenario::Static
            | Scenario::Active
            | Scenario::Interaction
            | Scenario::Resume
            | Scenario::MultiDisplay
    ) {
        require_metric("frame_time_ms", &statistics.frame_time_ms, missing);
    }
    if scenario == Scenario::Interaction {
        require_metric("input_to_image_ms", &statistics.input_to_image_ms, missing);
    }
}

fn require_metric(
    name: &'static str,
    value: &Option<Statistic>,
    missing: &mut BTreeSet<&'static str>,
) {
    if value
        .as_ref()
        .is_none_or(|value| value.observed_samples < MINIMUM_PASSES as usize)
    {
        missing.insert(name);
    }
}

fn metric_values(sample: &MeasurementSample) -> [Option<f64>; 9] {
    [
        sample.metrics.energy_joules,
        sample.metrics.average_watts,
        sample.metrics.cpu_percent,
        sample.metrics.gpu_percent,
        sample.metrics.wakeups_per_second,
        sample.metrics.memory_bytes,
        sample.metrics.frame_time_ms,
        sample.metrics.gpu_submissions,
        sample.metrics.input_to_image_ms,
    ]
}

fn validate_text(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        Err(format!("{label} must contain 1..=256 printable characters"))
    } else {
        Ok(())
    }
}

fn validate_sha256(value: &str, label: &str) -> Result<(), String> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("{label} must be a 64-character hexadecimal digest"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> MeasurementInput {
        let mut samples = Vec::new();
        for pass in 1..=5 {
            let scenarios: Vec<_> = if pass % 2 == 1 {
                Scenario::ALL.to_vec()
            } else {
                Scenario::ALL.iter().rev().copied().collect()
            };
            for (index, scenario) in scenarios.into_iter().enumerate() {
                samples.push(MeasurementSample {
                    pass,
                    order: index as u32 + 1,
                    scenario,
                    duration_seconds: 60.0,
                    metrics: MetricValues {
                        energy_joules: Some(120.0 + f64::from(pass)),
                        average_watts: Some(2.0),
                        cpu_percent: Some(3.0),
                        gpu_percent: Some(4.0),
                        wakeups_per_second: Some(5.0),
                        memory_bytes: Some(6.0),
                        frame_time_ms: matches!(
                            scenario,
                            Scenario::Static
                                | Scenario::Active
                                | Scenario::Interaction
                                | Scenario::Resume
                                | Scenario::MultiDisplay
                        )
                        .then_some(7.0),
                        gpu_submissions: (scenario != Scenario::NativeDesktop).then_some(
                            if matches!(scenario, Scenario::Pause | Scenario::Occlusion) {
                                0.0
                            } else {
                                8.0
                            },
                        ),
                        input_to_image_ms: (scenario == Scenario::Interaction).then_some(9.0),
                    },
                });
            }
        }
        MeasurementInput {
            schema_version: 1,
            machine: MachineContext {
                model: "MacBookPro18,3".into(),
                chip: "Apple M1 Pro".into(),
                memory_bytes: 16 * 1024 * 1024 * 1024,
                os_version: "26.2".into(),
                os_build: "25C56".into(),
                display_count: 1,
                display_mode: "1512x982".into(),
                refresh_hz: 120,
                power_source: "battery".into(),
            },
            warmup_seconds: 120,
            package_sha256: "a".repeat(64),
            instrument: "qualified instrument".into(),
            counter_scope: "system delta and process coalition".into(),
            samples,
            disturbances: Vec::new(),
        }
    }

    #[test]
    fn receipt_aggregates_five_alternating_passes() {
        let receipt = build_receipt(input(), "b".repeat(64)).unwrap();
        assert_eq!(receipt.status, QualificationStatus::Complete);
        assert_eq!(receipt.pass_count, 5);
        assert_eq!(receipt.summaries.len(), 8);
        assert_eq!(
            receipt.summaries[0]
                .statistics
                .energy_joules
                .as_ref()
                .unwrap()
                .median,
            123.0
        );
    }

    #[test]
    fn receipt_rejects_non_alternating_order() {
        let mut input = input();
        input.samples[8].scenario = Scenario::NativeDesktop;
        assert!(build_receipt(input, "b".repeat(64)).is_err());
    }

    #[test]
    fn receipt_rejects_submission_while_occluded() {
        let mut input = input();
        let sample = input
            .samples
            .iter_mut()
            .find(|sample| sample.scenario == Scenario::Occlusion)
            .unwrap();
        sample.metrics.gpu_submissions = Some(1.0);
        assert!(build_receipt(input, "b".repeat(64)).is_err());
    }

    #[test]
    fn missing_instrument_metrics_are_non_conclusive_not_zero() {
        let mut input = input();
        for sample in &mut input.samples {
            sample.metrics.energy_joules = None;
            sample.metrics.average_watts = None;
        }
        let receipt = build_receipt(input, "b".repeat(64)).unwrap();
        assert_eq!(receipt.status, QualificationStatus::NonConclusive);
        assert!(
            receipt
                .limitations
                .iter()
                .any(|limit| limit.starts_with("energy_joules"))
        );
    }
}
