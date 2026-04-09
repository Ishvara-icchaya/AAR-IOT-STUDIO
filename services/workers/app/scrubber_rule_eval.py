"""Safe boolean expression evaluator for scrubber health rules (no imports, no calls)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _get_path(obj: Any, dotted: str) -> Any:
    cur: Any = obj
    for part in dotted.split("."):
        if part == "":
            continue
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


@dataclass(frozen=True)
class _Tok:
    kind: str
    val: str | float | None = None


def _tokenize(expr: str) -> list[_Tok]:
    s = expr.strip()
    i = 0
    out: list[_Tok] = []
    n = len(s)
    while i < n:
        if s[i].isspace():
            i += 1
            continue
        if s[i] in "()":
            out.append(_Tok("paren", s[i]))
            i += 1
            continue
        if i + 1 < n and s[i : i + 2] in ("<=", ">=", "==", "!="):
            out.append(_Tok("op", s[i : i + 2]))
            i += 2
            continue
        if s[i] in "<>":
            out.append(_Tok("op", s[i]))
            i += 1
            continue
        if s[i].isdigit() or (s[i] == "." and i + 1 < n and s[i + 1].isdigit()):
            j = i
            while j < n and (s[j].isdigit() or s[j] == "."):
                j += 1
            chunk = s[i:j]
            try:
                num = float(chunk) if "." in chunk else int(chunk)
                out.append(_Tok("num", float(num)))
            except ValueError:
                out.append(_Tok("ident", chunk))
            i = j
            continue
        if s[i] in "\"'":
            q = s[i]
            i += 1
            buf: list[str] = []
            while i < n and s[i] != q:
                if s[i] == "\\" and i + 1 < n:
                    buf.append(s[i + 1])
                    i += 2
                    continue
                buf.append(s[i])
                i += 1
            if i >= n:
                raise ValueError("unterminated string")
            i += 1
            out.append(_Tok("str", "".join(buf)))
            continue
        j = i
        while j < n and (s[j].isalnum() or s[j] in "._"):
            j += 1
        word = s[i:j]
        if not word:
            raise ValueError(f"unexpected char {s[i]!r}")
        lw = word.lower()
        if lw == "and":
            out.append(_Tok("and"))
        elif lw == "or":
            out.append(_Tok("or"))
        else:
            out.append(_Tok("ident", word))
        i = j
    return out


def _coerce_num(x: Any) -> float | None:
    if x is None:
        return None
    if isinstance(x, bool):
        return float(int(x))
    if isinstance(x, (int, float)):
        return float(x)
    try:
        return float(str(x).strip())
    except (TypeError, ValueError):
        return None


def _eval_cmp_vals(a: Any, b: Any, op: str) -> bool:
    na, nb = _coerce_num(a), _coerce_num(b)
    if na is not None and nb is not None:
        if op == ">":
            return na > nb
        if op == "<":
            return na < nb
        if op == ">=":
            return na >= nb
        if op == "<=":
            return na <= nb
        if op == "==":
            return na == nb
        if op == "!=":
            return na != nb
    sa, sb = str(a), str(b)
    if op == "==":
        return sa == sb
    if op == "!=":
        return sa != sb
    return False


def _parse_primary(toks: list[_Tok], i: int) -> tuple[Any, int]:
    if i >= len(toks):
        raise ValueError("unexpected end")
    t = toks[i]
    if t.kind == "num":
        return t.val, i + 1
    if t.kind == "str":
        return t.val, i + 1
    if t.kind == "ident":
        return ("path", str(t.val)), i + 1
    if t.kind == "paren" and t.val == "(":
        node, j = _parse_or(toks, i + 1)
        if j >= len(toks) or toks[j].kind != "paren" or toks[j].val != ")":
            raise ValueError("expected )")
        return node, j + 1
    raise ValueError(f"unexpected token {t}")


def _parse_comparison(toks: list[_Tok], i: int) -> tuple[Any, int]:
    left, i = _parse_primary(toks, i)
    if i < len(toks) and toks[i].kind == "op":
        op = str(toks[i].val)
        right, i = _parse_primary(toks, i + 1)
        return ("cmp", left, op, right), i
    return left, i


def _parse_and(toks: list[_Tok], i: int) -> tuple[Any, int]:
    left, i = _parse_comparison(toks, i)
    while i < len(toks) and toks[i].kind == "and":
        right, i = _parse_comparison(toks, i + 1)
        left = ("and", left, right)
    return left, i


def _parse_or(toks: list[_Tok], i: int) -> tuple[Any, int]:
    left, i = _parse_and(toks, i)
    while i < len(toks) and toks[i].kind == "or":
        right, i = _parse_and(toks, i + 1)
        left = ("or", left, right)
    return left, i


def _eval_ast(node: Any, payload: dict[str, Any]) -> bool:
    if isinstance(node, tuple):
        if node[0] == "and":
            return _eval_ast(node[1], payload) and _eval_ast(node[2], payload)
        if node[0] == "or":
            return _eval_ast(node[1], payload) or _eval_ast(node[2], payload)
        if node[0] == "cmp":
            _, la, op, ra = node
            a = _get_path(payload, la[1]) if isinstance(la, tuple) and la[0] == "path" else la
            b = _get_path(payload, ra[1]) if isinstance(ra, tuple) and ra[0] == "path" else ra
            return _eval_cmp_vals(a, b, str(op))
    if isinstance(node, tuple) and node[0] == "path":
        v = _get_path(payload, node[1])
        if v is None:
            return False
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return v != 0
        return str(v) != ""
    if isinstance(node, bool):
        return node
    if isinstance(node, (int, float)):
        return node != 0
    return bool(node)


def eval_rule_condition(expr: str, payload: dict[str, Any]) -> bool:
    """Evaluate a constrained condition string against the payload."""
    e = expr.strip()
    if not e:
        return False
    toks = _tokenize(e)
    if not toks:
        return False
    ast, pos = _parse_or(toks, 0)
    if pos != len(toks):
        raise ValueError("trailing garbage in condition")
    return _eval_ast(ast, payload)


def validate_condition_syntax(expr: str) -> str | None:
    """Return error message if invalid, else None."""
    try:
        e = expr.strip()
        if not e:
            return "empty condition"
        toks = _tokenize(e)
        _, pos = _parse_or(toks, 0)
        if pos != len(toks):
            return "trailing garbage"
        return None
    except Exception as ex:
        return str(ex)[:200]
