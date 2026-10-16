#!/usr/bin/env python3
"""
Verificador de contraste WCAG 2.1. Sin dependencias.

Uso:
  python3 contrast.py "#1a1a1a" "#ffffff"
  python3 contrast.py "oklch(0.6 0.2 250)" "white" --size 18 --bold
  python3 contrast.py --pairs pairs.json
  python3 contrast.py --suggest "#3b82f6" "#ffffff"

Formatos aceptados: #rgb, #rrggbb, rgb(r,g,b), oklch(L C H), y nombres CSS básicos.
Salida: ratio + PASS/FAIL para AA y AAA. Exit code 1 si algo falla AA.
"""
import sys, json, re, math

NAMED = {
    "white": "#ffffff", "black": "#000000", "red": "#ff0000", "lime": "#00ff00",
    "blue": "#0000ff", "yellow": "#ffff00", "cyan": "#00ffff", "magenta": "#ff00ff",
    "silver": "#c0c0c0", "gray": "#808080", "grey": "#808080", "maroon": "#800000",
    "olive": "#808000", "green": "#008000", "purple": "#800080", "teal": "#008080",
    "navy": "#000080", "orange": "#ffa500", "transparent": None,
}


def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _oklch_to_srgb(L, C, H):
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def enc(x):
        x = max(0.0, min(1.0, x))
        v = 12.92 * x if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055
        return round(max(0.0, min(1.0, v)) * 255)

    return (enc(r), enc(g), enc(bb))


def parse(color):
    """Devuelve (r,g,b) 0-255."""
    if color is None:
        raise ValueError("color vacío")
    c = str(color).strip().lower()
    if c in NAMED:
        if NAMED[c] is None:
            raise ValueError("transparent no tiene contraste definido; resuelve el fondo real")
        c = NAMED[c]
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        if len(h) == 8:
            h = h[:6]  # ignora alfa: avisa aparte
        if len(h) != 6:
            raise ValueError(f"hex inválido: {color}")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = re.match(r"rgba?\(([^)]+)\)", c)
    if m:
        parts = re.split(r"[,\s/]+", m.group(1).strip())
        return tuple(int(round(float(p.rstrip("%")) * (2.55 if "%" in p else 1))) for p in parts[:3])
    m = re.match(r"oklch\(([^)]+)\)", c)
    if m:
        parts = re.split(r"[,\s/]+", m.group(1).strip())
        L = float(parts[0].rstrip("%")) / (100 if "%" in parts[0] else 1)
        C = float(parts[1])
        H = float(parts[2].rstrip("deg"))
        return _oklch_to_srgb(L, C, H)
    raise ValueError(f"formato no reconocido: {color}")


def luminance(rgb):
    r, g, b = (_srgb_to_linear(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    l1, l2 = luminance(parse(fg)), luminance(parse(bg))
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def thresholds(size_px=16, bold=False, target="text"):
    """Devuelve (aa, aaa) requeridos."""
    if target in ("ui", "icon", "border", "focus"):
        return (3.0, 3.0)
    large = size_px >= 24 or (bold and size_px >= 18.66)
    return (3.0, 4.5) if large else (4.5, 7.0)


def check(fg, bg, size_px=16, bold=False, target="text", label=""):
    r = ratio(fg, bg)
    aa, aaa = thresholds(size_px, bold, target)
    return {
        "label": label, "fg": fg, "bg": bg, "ratio": round(r, 2),
        "required_aa": aa, "required_aaa": aaa,
        "aa": r >= aa, "aaa": r >= aaa,
    }


def suggest(fg, bg, target_ratio=4.5):
    """Oscurece/aclara fg hasta alcanzar el ratio. Devuelve hex."""
    base = parse(fg)
    bg_l = luminance(parse(bg))
    darken = bg_l > 0.18  # fondo claro -> oscurecer texto
    best = None
    for i in range(101):
        f = i / 100
        if darken:
            cand = tuple(round(v * (1 - f)) for v in base)
        else:
            cand = tuple(round(v + (255 - v) * f) for v in base)
        if ratio("#%02x%02x%02x" % cand, bg) >= target_ratio:
            best = cand
            break
    return "#%02x%02x%02x" % best if best else None


def _fmt(res):
    mark = "PASS" if res["aa"] else "FAIL"
    extra = " AAA" if res["aaa"] else ""
    name = f'{res["label"]}: ' if res["label"] else ""
    return f'[{mark}]{extra} {name}{res["fg"]} sobre {res["bg"]} = {res["ratio"]}:1 (AA necesita {res["required_aa"]}:1)'


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0

    if args[0] == "--pairs":
        with open(args[1]) as f:
            pairs = json.load(f)
        results = [check(p["fg"], p["bg"], p.get("size", 16), p.get("bold", False),
                         p.get("target", "text"), p.get("label", "")) for p in pairs]
        failed = 0
        for r in results:
            print(_fmt(r))
            if not r["aa"]:
                failed += 1
                s = suggest(r["fg"], r["bg"], r["required_aa"])
                if s:
                    print(f'       -> usa {s} para pasar AA')
        print(f'\n{len(results) - failed}/{len(results)} pasan AA')
        return 1 if failed else 0

    if args[0] == "--suggest":
        fg, bg = args[1], args[2]
        t = float(args[4]) if len(args) > 4 and args[3] == "--target" else 4.5
        print(f'{fg} sobre {bg} = {round(ratio(fg, bg), 2)}:1')
        s = suggest(fg, bg, t)
        print(f'sugerencia para {t}:1 -> {s} ({round(ratio(s, bg), 2)}:1)' if s
              else f'imposible alcanzar {t}:1 ajustando solo el color de texto; cambia el fondo')
        return 0

    fg, bg = args[0], args[1]
    size = 16.0
    bold = "--bold" in args
    target = "text"
    if "--size" in args:
        size = float(args[args.index("--size") + 1])
    if "--target" in args:
        target = args[args.index("--target") + 1]
    r = check(fg, bg, size, bold, target)
    print(_fmt(r))
    if not r["aa"]:
        s = suggest(fg, bg, r["required_aa"])
        if s:
            print(f'-> usa {s} ({round(ratio(s, bg), 2)}:1)')
    return 0 if r["aa"] else 1


if __name__ == "__main__":
    sys.exit(main())
