"""Generic decode_series scrubber step (see docs/SCRUBBER_DECODE_SERIES_SPEC.md)."""

from __future__ import annotations

import base64
import binascii
import math
import os
import struct
import time
from typing import Any

V1_MODES = frozenset({"scalar", "array", "base64_binary", "csv_numbers", "hex_binary"})
BINARY_DT = frozenset({"int16", "int32", "float32"})
ARRAY_SCALAR_DT = frozenset({"float", "int", "int16", "int32", "float32"})


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return max(1.0, float(raw))
    except ValueError:
        return default


def _normalize_path(path: str) -> str:
    p = path.strip()
    if p.startswith("$."):
        return p[2:]
    if p.startswith("$"):
        return p.lstrip("$").lstrip(".")
    return p


def _get_dotted(obj: Any, dotted: str) -> Any:
    cur: Any = obj
    for part in _normalize_path(dotted).split("."):
        if part == "":
            continue
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _set_dotted(root: dict[str, Any], dotted: str, value: Any) -> None:
    parts = [p for p in _normalize_path(dotted).split(".") if p]
    if not parts:
        return
    cur: Any = root
    for part in parts[:-1]:
        if not isinstance(cur, dict):
            return
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    if isinstance(cur, dict):
        cur[parts[-1]] = value


def _error_blob(*, source_path: str, error_code: str, message: str) -> dict[str, Any]:
    return {
        "step_type": "decode_series",
        "source_path": source_path,
        "error_code": error_code,
        "message": message,
    }


def _is_integer_dtype(dt: str) -> bool:
    return dt in ("int", "int16", "int32")


def _parse_scalar_token(raw: Any, data_type: str) -> float | int:
    dt = (data_type or "float").lower().strip()
    if isinstance(raw, bool):
        raise ValueError("NON_NUMERIC_VALUE")
    if isinstance(raw, int) and not isinstance(raw, bool):
        if _is_integer_dtype(dt):
            return int(raw)
        return float(raw)
    if isinstance(raw, float):
        if not math.isfinite(raw):
            raise ValueError("NON_NUMERIC_VALUE")
        if _is_integer_dtype(dt):
            return int(raw)
        return float(raw)
    if raw is None:
        raise ValueError("NON_NUMERIC_VALUE")
    s = str(raw).strip()
    if not s:
        raise ValueError("NON_NUMERIC_VALUE")
    if _is_integer_dtype(dt):
        try:
            if "." in s or "e" in s.lower():
                n = float(s)
                if not math.isfinite(n):
                    raise ValueError
                return int(n)
            return int(s, 10)
        except (TypeError, ValueError, OverflowError):
            raise ValueError("NON_NUMERIC_VALUE") from None
    try:
        n = float(s)
    except ValueError:
        raise ValueError("NON_NUMERIC_VALUE") from None
    if not math.isfinite(n):
        raise ValueError("NON_NUMERIC_VALUE")
    return float(n)


def _unpack_binary(data: bytes, data_type: str, byte_order: str) -> list[float | int]:
    bo = (byte_order or "little").lower().strip()
    endian = "<" if bo == "little" else ">" if bo == "big" else ""
    if not endian:
        raise ValueError("UNSUPPORTED_DATA_TYPE")
    dt = (data_type or "").lower().strip()
    if dt == "int16":
        fmt = endian + "h"
    elif dt == "int32":
        fmt = endian + "i"
    elif dt == "float32":
        fmt = endian + "f"
    else:
        raise ValueError("UNSUPPORTED_DATA_TYPE")
    item = struct.calcsize(fmt)
    if item <= 0 or len(data) % item != 0:
        raise ValueError("BINARY_LENGTH_MISMATCH")
    out: list[float | int] = []
    for off in range(0, len(data), item):
        chunk = data[off : off + item]
        (val,) = struct.unpack(fmt, chunk)
        if isinstance(val, float):
            if not math.isfinite(val):
                raise ValueError("NON_NUMERIC_VALUE")
            out.append(float(val))
        else:
            out.append(int(val))
    return out


def _decode_one_step(
    step: dict[str, Any],
    payload: dict[str, Any],
    *,
    t0: float,
    max_processing_ms: float,
    max_decoded_bytes: int,
    max_samples: int,
    max_csv_length: int,
    max_hex_length: int,
) -> dict[str, Any]:
    def _deadline() -> None:
        if (time.monotonic() - t0) * 1000.0 > max_processing_ms:
            raise ValueError("MAX_PROCESSING_TIME")

    source_path = str(_pick(step, "source_path", "sourcePath") or "").strip()
    target_path = str(_pick(step, "target_path", "targetPath") or "").strip()
    if not source_path:
        raise ValueError("SOURCE_PATH_MISSING")
    if not target_path:
        raise ValueError("TARGET_PATH_MISSING")

    mode = str(_pick(step, "mode") or "").strip()
    if mode not in V1_MODES:
        raise ValueError("UNSUPPORTED_MODE")

    data_type = str(_pick(step, "data_type", "dataType") or "").strip().lower()
    if mode in ("base64_binary", "hex_binary"):
        if data_type not in BINARY_DT:
            raise ValueError("UNSUPPORTED_DATA_TYPE")
        byte_order = str(_pick(step, "byte_order", "byteOrder") or "").strip().lower()
        if byte_order not in ("little", "big"):
            raise ValueError("UNSUPPORTED_DATA_TYPE")
    else:
        byte_order = str(_pick(step, "byte_order", "byteOrder") or "little").strip().lower()
        if data_type not in ARRAY_SCALAR_DT:
            raise ValueError("UNSUPPORTED_DATA_TYPE")

    scale = float(step["scale"]) if isinstance(_pick(step, "scale"), (int, float)) else 1.0
    offset = float(step["offset"]) if isinstance(_pick(step, "offset"), (int, float)) else 0.0
    if not math.isfinite(scale) or not math.isfinite(offset):
        raise ValueError("NON_NUMERIC_VALUE")

    unit = _pick(step, "unit")
    unit_out = unit if isinstance(unit, str) or unit is None else str(unit)
    sample_rate_hz = _pick(step, "sample_rate_hz", "sampleRateHz")

    store_samples = _pick(step, "store_samples", "storeSamples")
    if store_samples is None:
        store_samples = True
    if not isinstance(store_samples, bool):
        store_samples = bool(store_samples)

    mst = _pick(step, "max_samples_to_store", "maxSamplesToStore")
    max_samples_to_store = int(mst) if isinstance(mst, int) else 1000
    max_samples_to_store = max(0, max_samples_to_store)

    aggs = _pick(step, "aggregations")
    if isinstance(aggs, list) and aggs:
        want = {str(a).strip().lower() for a in aggs if isinstance(a, str) and str(a).strip()}
    else:
        want = {"latest", "count"}

    series: list[float | int] = []

    if mode == "scalar":
        _deadline()
        raw_val = _get_dotted(payload, source_path)
        if raw_val is None:
            raise ValueError("SOURCE_PATH_MISSING")
        series = [_parse_scalar_token(raw_val, data_type)]
    elif mode == "array":
        _deadline()
        raw_val = _get_dotted(payload, source_path)
        if raw_val is None:
            raise ValueError("SOURCE_PATH_MISSING")
        if not isinstance(raw_val, list):
            raise ValueError("NON_NUMERIC_VALUE")
        series = [_parse_scalar_token(x, data_type) for x in raw_val]
    elif mode == "csv_numbers":
        _deadline()
        raw_val = _get_dotted(payload, source_path)
        if raw_val is None:
            raise ValueError("SOURCE_PATH_MISSING")
        s = raw_val if isinstance(raw_val, str) else str(raw_val)
        if len(s) > max_csv_length:
            raise ValueError("MAX_SAMPLES_EXCEEDED")
        if s.strip() == "":
            series = []
        else:
            series = []
            for tok in s.split(","):
                tok = tok.strip()
                if tok == "":
                    continue
                series.append(_parse_scalar_token(tok, data_type))
    elif mode == "base64_binary":
        _deadline()
        raw_val = _get_dotted(payload, source_path)
        if raw_val is None:
            raise ValueError("SOURCE_PATH_MISSING")
        if not isinstance(raw_val, str):
            raise ValueError("INVALID_BASE64")
        enc = str(_pick(step, "encoding") or "base64").strip().lower()
        if enc != "base64":
            raise ValueError("UNSUPPORTED_MODE")
        try:
            data = base64.b64decode(raw_val, validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("INVALID_BASE64") from None
        if len(data) > max_decoded_bytes:
            raise ValueError("MAX_SAMPLES_EXCEEDED")
        series = _unpack_binary(data, data_type, byte_order)
    elif mode == "hex_binary":
        _deadline()
        raw_val = _get_dotted(payload, source_path)
        if raw_val is None:
            raise ValueError("SOURCE_PATH_MISSING")
        hs = raw_val if isinstance(raw_val, str) else str(raw_val)
        hs = "".join(hs.split())
        if len(hs) > max_hex_length:
            raise ValueError("MAX_SAMPLES_EXCEEDED")
        if len(hs) % 2 != 0:
            raise ValueError("INVALID_HEX")
        try:
            data = binascii.unhexlify(hs.encode("ascii"))
        except (binascii.Error, ValueError):
            raise ValueError("INVALID_HEX") from None
        if len(data) > max_decoded_bytes:
            raise ValueError("MAX_SAMPLES_EXCEEDED")
        series = _unpack_binary(data, data_type, byte_order)
    else:
        raise ValueError("UNSUPPORTED_MODE")

    _deadline()
    if len(series) > max_samples:
        raise ValueError("MAX_SAMPLES_EXCEEDED")

    scaled: list[float | int] = []
    for v in series:
        x = float(v) * scale + offset
        if not math.isfinite(x):
            raise ValueError("NON_NUMERIC_VALUE")
        if mode in ("base64_binary", "hex_binary") and data_type in ("int16", "int32"):
            scaled.append(int(x))
        elif mode in ("scalar", "array", "csv_numbers") and _is_integer_dtype(data_type):
            scaled.append(int(x))
        else:
            scaled.append(float(x))

    n = len(scaled)
    agg: dict[str, Any] = {}
    if "count" in want:
        agg["count"] = n
    if n > 0:
        nums = [float(x) for x in scaled]
        if "min" in want:
            agg["min"] = min(nums)
        if "max" in want:
            agg["max"] = max(nums)
        if "avg" in want:
            agg["avg"] = sum(nums) / n
        if "latest" in want:
            agg["latest"] = scaled[-1]
    else:
        if "min" in want:
            agg["min"] = None
        if "max" in want:
            agg["max"] = None
        if "avg" in want:
            agg["avg"] = None
        if "latest" in want:
            agg["latest"] = None

    if store_samples and n > 0:
        take = min(n, max_samples_to_store)
        samples_out = scaled[-take:]
    else:
        samples_out = []

    meta: dict[str, Any] = {
        "unit": unit_out,
        "data_type": data_type,
        "sample_rate_hz": sample_rate_hz,
        "source_mode": mode,
    }
    if not store_samples:
        meta["sample_count"] = n
        meta["samples_stored"] = False

    return {"samples": samples_out, "meta": meta, "aggregations": agg}


def _pick(step: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in step:
            return step[k]
    return None


def apply_decode_series_steps(payload: dict[str, Any], steps: Any) -> None:
    """Mutates payload in place. Reads ``decodeSeriesSteps`` from scrubberStudio draft/active."""
    if not isinstance(steps, list) or not steps:
        return

    max_decoded_bytes = _env_int("SCRUBBER_DECODE_SERIES_MAX_DECODED_BYTES", 1048576)
    max_samples = _env_int("SCRUBBER_DECODE_SERIES_MAX_SAMPLES", 10000)
    max_csv_length = _env_int("SCRUBBER_DECODE_SERIES_MAX_CSV_LENGTH", 262144)
    max_hex_length = _env_int("SCRUBBER_DECODE_SERIES_MAX_HEX_LENGTH", 262144)
    max_processing_ms = _env_float("SCRUBBER_DECODE_SERIES_MAX_PROCESSING_MS", 50.0)

    messages: dict[str, str] = {
        "SOURCE_PATH_MISSING": "Source path did not resolve to a value.",
        "TARGET_PATH_MISSING": "target_path is required.",
        "UNSUPPORTED_MODE": "Unsupported decode_series mode.",
        "UNSUPPORTED_DATA_TYPE": "Unsupported data_type for this mode.",
        "INVALID_BASE64": "Unable to decode base64 series field.",
        "INVALID_HEX": "Unable to decode hex series field.",
        "INVALID_CSV_TOKEN": "Invalid CSV number token.",
        "BINARY_LENGTH_MISMATCH": "Binary length does not match data_type width.",
        "MAX_SAMPLES_EXCEEDED": "Decoded series exceeds configured or security limits.",
        "NON_NUMERIC_VALUE": "Value could not be parsed as a number.",
        "MAX_PROCESSING_TIME": "Decode series step exceeded time limit.",
    }

    for step in steps:
        if not isinstance(step, dict):
            continue
        if str(_pick(step, "step_type", "stepType") or "").strip() != "decode_series":
            continue
        src = str(_pick(step, "source_path", "sourcePath") or "").strip()
        tgt = str(_pick(step, "target_path", "targetPath") or "").strip()
        t0 = time.monotonic()
        try:
            out = _decode_one_step(
                step,
                payload,
                t0=t0,
                max_processing_ms=max_processing_ms,
                max_decoded_bytes=max_decoded_bytes,
                max_samples=max_samples,
                max_csv_length=max_csv_length,
                max_hex_length=max_hex_length,
            )
            _set_dotted(payload, tgt, out)
        except ValueError as e:
            code = str(e) if str(e) in messages else "NON_NUMERIC_VALUE"
            _set_dotted(
                payload,
                tgt,
                {"_error": _error_blob(source_path=src, error_code=code, message=messages.get(code, code))},
            )
