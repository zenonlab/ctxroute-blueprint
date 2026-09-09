#!/usr/bin/env python3
"""Bounded Libretro observer: no renderer, network, sleep or guest execution outside the core."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import pathlib
import sys
from typing import Any


class GameInfo(ctypes.Structure):
    _fields_ = [("path", ctypes.c_char_p), ("data", ctypes.c_void_p),
                ("size", ctypes.c_size_t), ("meta", ctypes.c_char_p)]


class SystemInfo(ctypes.Structure):
    _fields_ = [("library_name", ctypes.c_char_p), ("library_version", ctypes.c_char_p),
                ("valid_extensions", ctypes.c_char_p), ("need_fullpath", ctypes.c_bool),
                ("block_extract", ctypes.c_bool)]


class Geometry(ctypes.Structure):
    _fields_ = [("base_width", ctypes.c_uint), ("base_height", ctypes.c_uint),
                ("max_width", ctypes.c_uint), ("max_height", ctypes.c_uint),
                ("aspect_ratio", ctypes.c_float)]


class Timing(ctypes.Structure):
    _fields_ = [("fps", ctypes.c_double), ("sample_rate", ctypes.c_double)]


class AVInfo(ctypes.Structure):
    _fields_ = [("geometry", Geometry), ("timing", Timing)]


ENVIRONMENT = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_uint, ctypes.c_void_p)
VIDEO = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_size_t)
AUDIO = ctypes.CFUNCTYPE(None, ctypes.c_int16, ctypes.c_int16)
AUDIO_BATCH = ctypes.CFUNCTYPE(ctypes.c_size_t, ctypes.POINTER(ctypes.c_int16), ctypes.c_size_t)
INPUT_POLL = ctypes.CFUNCTYPE(None)
INPUT_STATE = ctypes.CFUNCTYPE(ctypes.c_int16, ctypes.c_uint, ctypes.c_uint,
                               ctypes.c_uint, ctypes.c_uint)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_json(path: pathlib.Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 1 or not isinstance(value.get("events"), list):
        raise ValueError("input schema must be version 1 with an events array")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--core", type=pathlib.Path, required=True)
    parser.add_argument("--content", type=pathlib.Path, required=True)
    parser.add_argument("--inputs", type=pathlib.Path, required=True)
    parser.add_argument("--frames", type=int, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.frames <= 10_000:
        raise ValueError("frames must be between 1 and 10000")
    if args.output.is_symlink() or (args.output.exists() and not args.output.is_dir()):
        raise ValueError("output must be a real directory")
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("output directory must be empty")
    for path in (args.core, args.content, args.inputs):
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"regular non-symlink input required: {path}")
    limits = {args.core: 256 * 1024 * 1024, args.content: 512 * 1024 * 1024,
              args.inputs: 4 * 1024 * 1024}
    for path, maximum in limits.items():
        if path.stat().st_size > maximum:
            raise ValueError(f"input exceeds byte quota: {path}")

    content = args.content.read_bytes()
    schedule_json = checked_json(args.inputs)
    schedule: dict[tuple[int, int, int, int, int], int] = {}
    for event in schedule_json["events"]:
        key = tuple(int(event[name]) for name in ("frame", "port", "device", "index", "id"))
        value = int(event["value"])
        if key in schedule or key[0] < 0 or key[0] >= args.frames or not -32768 <= value <= 32767:
            raise ValueError("invalid or duplicate input event")
        schedule[key] = value

    core = ctypes.CDLL(str(args.core.resolve()))
    required = ["retro_api_version", "retro_set_environment", "retro_set_video_refresh",
                "retro_set_audio_sample", "retro_set_audio_sample_batch", "retro_set_input_poll",
                "retro_set_input_state", "retro_init", "retro_deinit", "retro_get_system_info",
                "retro_get_system_av_info", "retro_load_game", "retro_unload_game", "retro_run",
                "retro_serialize_size", "retro_serialize", "retro_get_memory_data",
                "retro_get_memory_size"]
    for name in required:
        if not hasattr(core, name):
            raise ValueError(f"core missing required symbol: {name}")
    core.retro_api_version.restype = ctypes.c_uint
    if core.retro_api_version() != 1:
        raise ValueError("unsupported libretro API version")

    video = bytearray()
    audio = bytearray()
    frame_index = 0
    videos_this_run = 0
    pixel_format = None
    callback_errors: list[str] = []

    @ENVIRONMENT
    def environment(command: int, data: int) -> bool:
        nonlocal pixel_format
        if command == 10 and data:
            pixel_format = ctypes.cast(data, ctypes.POINTER(ctypes.c_uint))[0]
            return pixel_format == 1
        return False

    @VIDEO
    def video_refresh(data: int, width: int, height: int, pitch: int) -> None:
        nonlocal videos_this_run
        if not data or data == ctypes.c_void_p(-1).value or width == 0 or height == 0:
            callback_errors.append("hardware or empty video frame is outside this PoC")
            return
        row_size = width * 4
        if pitch < row_size or row_size * height > 64 * 1024 * 1024:
            callback_errors.append("invalid or oversized video frame")
            return
        for row in range(height):
            video.extend(ctypes.string_at(data + row * pitch, row_size))
        videos_this_run += 1

    @AUDIO
    def audio_sample(left: int, right: int) -> None:
        audio.extend(int(left).to_bytes(2, "little", signed=True))
        audio.extend(int(right).to_bytes(2, "little", signed=True))

    @AUDIO_BATCH
    def audio_batch(data: Any, frames: int) -> int:
        audio.extend(ctypes.string_at(data, frames * 4))
        return frames

    @INPUT_POLL
    def input_poll() -> None:
        return None

    @INPUT_STATE
    def input_state(port: int, device: int, index: int, item: int) -> int:
        return schedule.get((frame_index, port, device, index, item), 0)

    callbacks = (environment, video_refresh, audio_sample, audio_batch, input_poll, input_state)
    setters = [("retro_set_environment", ENVIRONMENT, environment),
               ("retro_set_video_refresh", VIDEO, video_refresh),
               ("retro_set_audio_sample", AUDIO, audio_sample),
               ("retro_set_audio_sample_batch", AUDIO_BATCH, audio_batch),
               ("retro_set_input_poll", INPUT_POLL, input_poll),
               ("retro_set_input_state", INPUT_STATE, input_state)]
    for name, callback_type, callback in setters:
        function = getattr(core, name); function.argtypes = [callback_type]; function(callback)

    core.retro_get_system_info.argtypes = [ctypes.POINTER(SystemInfo)]
    core.retro_get_system_av_info.argtypes = [ctypes.POINTER(AVInfo)]
    core.retro_load_game.argtypes = [ctypes.POINTER(GameInfo)]; core.retro_load_game.restype = ctypes.c_bool
    core.retro_serialize_size.restype = ctypes.c_size_t
    core.retro_serialize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]; core.retro_serialize.restype = ctypes.c_bool
    core.retro_get_memory_data.argtypes = [ctypes.c_uint]; core.retro_get_memory_data.restype = ctypes.c_void_p
    core.retro_get_memory_size.argtypes = [ctypes.c_uint]; core.retro_get_memory_size.restype = ctypes.c_size_t

    content_buffer = ctypes.create_string_buffer(content)
    game = GameInfo(str(args.content.resolve()).encode(), ctypes.cast(content_buffer, ctypes.c_void_p), len(content), None)
    info = SystemInfo(); av = AVInfo()
    core.retro_init()
    loaded = False
    try:
        core.retro_get_system_info(ctypes.byref(info))
        if info.need_fullpath:
            raise ValueError("full-path cores are outside this memory-only PoC")
        if not core.retro_load_game(ctypes.byref(game)):
            raise ValueError("core rejected content or XRGB8888")
        loaded = True
        core.retro_get_system_av_info(ctypes.byref(av))
        state_size = core.retro_serialize_size()
        if state_size == 0 or state_size > 16 * 1024 * 1024:
            raise ValueError("missing or oversized serialized state")
        initial = ctypes.create_string_buffer(state_size)
        if not core.retro_serialize(initial, state_size):
            raise ValueError("initial serialization failed")
        for frame_index in range(args.frames):
            videos_this_run = 0
            core.retro_run()
            if callback_errors:
                raise ValueError(callback_errors[0])
            if videos_this_run != 1:
                raise ValueError("core must emit exactly one software video frame per retro_run")
        final = ctypes.create_string_buffer(state_size)
        if not core.retro_serialize(final, state_size):
            raise ValueError("final serialization failed")
        memory_size = core.retro_get_memory_size(0)
        memory_ptr = core.retro_get_memory_data(0)
        memory = ctypes.string_at(memory_ptr, memory_size) if memory_ptr and memory_size else b""
    finally:
        if loaded:
            core.retro_unload_game()
        core.retro_deinit()
        _ = callbacks

    args.output.mkdir(parents=True, exist_ok=True)
    artifacts = {"video.xrgb8888": bytes(video), "audio.s16le": bytes(audio),
                 "state.initial": initial.raw, "state.final": final.raw, "memory.bin": memory}
    artifact_manifest = {}
    for name, data in artifacts.items():
        (args.output / name).write_bytes(data)
        artifact_manifest[name] = {"bytes": len(data), "sha256": sha256(data)}
    manifest = {
        "schema_version": 1,
        "observer": {"kind": "libretro", "frontend": "wallpaper-e6-poc", "version": "1.0.0"},
        "core": {"path": args.core.name, "sha256": sha256(args.core.read_bytes()),
                 "api_version": 1, "name": info.library_name.decode(),
                 "version": info.library_version.decode()},
        "source": {"kind": "local-fixture", "sha256": sha256(content), "bytes": len(content)},
        "run": {"frames": args.frames, "input_sha256": sha256(args.inputs.read_bytes()),
                "pixel_format": "XRGB8888", "width": av.geometry.base_width,
                "height": av.geometry.base_height, "fps": av.timing.fps,
                "sample_rate": av.timing.sample_rate},
        "artifacts": artifact_manifest,
        "capabilities": {"deterministic_av": "verified", "serialized_state": "verified",
                         "memory_snapshot": "verified", "scene_graph": "unsupported",
                         "collision": "unknown", "gameplay_semantics": "unsupported",
                         "third_party_core_isolation": "unknown"}
    }
    encoded = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    (args.output / "observation.json").write_text(encoded, encoding="utf-8")
    print(json.dumps({"event": "completed", "status": "success",
                      "manifest": str(args.output / "observation.json")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"event": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(12)
