"""Tests for decode_series scrubber step."""

from __future__ import annotations

import base64
import json
import struct

from app.services.scrubber_engine import run_scrubber


def _run(raw: dict, steps: list[dict]) -> dict:
    body = json.dumps(raw).encode("utf-8")
    ss = {
        "draft": {
            "parseAs": "json",
            "objectName": "t",
            "decodeSeriesSteps": steps,
        }
    }
    return run_scrubber(raw_bytes=body, content_type="application/json", scrubber_studio=ss).payload


def test_scalar_float() -> None:
    p = _run({"t": 25.6}, [{"step_type": "decode_series", "source_path": "t", "target_path": "out", "mode": "scalar", "data_type": "float"}])
    assert p["out"]["samples"] == [25.6]
    assert p["out"]["aggregations"]["count"] == 1
    assert p["out"]["aggregations"]["latest"] == 25.6


def test_array_int() -> None:
    p = _run({"x": [1, 2, 3]}, [{"step_type": "decode_series", "source_path": "x", "target_path": "d", "mode": "array", "data_type": "int"}])
    assert p["d"]["samples"] == [1, 2, 3]
    assert p["d"]["aggregations"]["avg"] == 2.0


def test_csv_numbers() -> None:
    p = _run(
        {"s": "-376,-413,-407"},
        [{"step_type": "decode_series", "source_path": "s", "target_path": "d", "mode": "csv_numbers", "data_type": "float"}],
    )
    assert p["d"]["samples"] == [-376.0, -413.0, -407.0]
    assert abs(p["d"]["aggregations"]["avg"] - (-398.6666666667)) < 0.01


def test_base64_int32_little() -> None:
    vals = [-376, -413, -407]
    buf = b"".join(struct.pack("<i", v) for v in vals)
    b64 = base64.b64encode(buf).decode("ascii")
    p = _run(
        {"b": b64},
        [
            {
                "step_type": "decode_series",
                "source_path": "b",
                "target_path": "d",
                "mode": "base64_binary",
                "encoding": "base64",
                "data_type": "int32",
                "byte_order": "little",
            }
        ],
    )
    assert p["d"]["samples"] == vals
    assert p["d"]["meta"]["source_mode"] == "base64_binary"


def test_hex_int16() -> None:
    buf = struct.pack("<h", -376) + struct.pack("<h", 100)
    hx = buf.hex()
    p = _run(
        {"h": hx},
        [{"step_type": "decode_series", "source_path": "h", "target_path": "d", "mode": "hex_binary", "data_type": "int16", "byte_order": "little"}],
    )
    assert p["d"]["samples"] == [-376, 100]


def test_store_samples_false() -> None:
    p = _run(
        {"x": [1, 2, 3]},
        [
            {
                "step_type": "decode_series",
                "source_path": "x",
                "target_path": "d",
                "mode": "array",
                "data_type": "float",
                "store_samples": False,
            }
        ],
    )
    assert p["d"]["samples"] == []
    assert p["d"]["meta"]["samples_stored"] is False
    assert p["d"]["meta"]["sample_count"] == 3
    assert p["d"]["aggregations"]["count"] == 3


def test_dollar_paths() -> None:
    p = _run(
        {"body": {"pack": {"c": "1,2"}}},
        [{"step_type": "decode_series", "source_path": "$.body.pack.c", "target_path": "$.decoded.pack", "mode": "csv_numbers", "data_type": "int"}],
    )
    assert "decoded" in p
    assert p["decoded"]["pack"]["samples"] == [1, 2]


def test_invalid_base64_error_shape() -> None:
    p = _run(
        {"b": "not!!!valid"},
        [
            {
                "step_type": "decode_series",
                "source_path": "b",
                "target_path": "d",
                "mode": "base64_binary",
                "encoding": "base64",
                "data_type": "int32",
                "byte_order": "little",
            }
        ],
    )
    err = p["d"].get("_error")
    assert isinstance(err, dict)
    assert err.get("error_code") == "INVALID_BASE64"


def test_scale_offset() -> None:
    p = _run(
        {"x": [10, 20]},
        [
            {
                "step_type": "decode_series",
                "source_path": "x",
                "target_path": "d",
                "mode": "array",
                "data_type": "float",
                "scale": 0.1,
                "offset": 1,
            }
        ],
    )
    assert p["d"]["samples"] == [2.0, 3.0]
