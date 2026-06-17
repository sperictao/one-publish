#!/usr/bin/env python3
"""Remove remaining glassmorphism: replace glass background tokens and backdrop-blur with solid design tokens."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent / "src"

CSS_REPLACEMENTS = [
    # glass-panel
    (
        r"\.glass-panel \{\s*background:\s*var\(--glass-panel-bg\);\s*\}",
        ".glass-panel {\n  background: hsl(var(--card));\n}",
    ),
    # glass-surface
    (
        r"\.glass-surface \{[^}]*\}",
        """.glass-surface {
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  position: relative;
  overflow: hidden;
}""",
    ),
    # glass-surface pseudo
    (
        r"\.glass-surface::before \{[^}]*\}",
        ".glass-surface::before {\n  content: none;\n}",
    ),
    # glass-surface-selected
    (
        r"\.glass-surface-selected \{[^}]*\}",
        """.glass-surface-selected {
  background: hsl(var(--accent));
  border: 1px solid hsl(var(--border));
  position: relative;
}""",
    ),
    # glass-surface-selected pseudo
    (
        r"\.glass-surface-selected::before \{[^}]*\}",
        ".glass-surface-selected::before {\n  content: none;\n}",
    ),
    # glass-input
    (
        r"\.glass-input \{[^}]*\}",
        """.glass-input {
  background: hsl(var(--background));
  border: 1px solid hsl(var(--input));
  transition:
    border-color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}""",
    ),
    # glass-input:focus-within
    (
        r"\.glass-input:focus-within \{[^}]*\}",
        """.glass-input:focus-within {
  background: hsl(var(--muted));
  border-color: hsl(var(--border));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
}""",
    ),
    # glass-card
    (
        r"\.glass-card \{[^}]*\}",
        """.glass-card {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  position: relative;
  overflow: hidden;
}""",
    ),
    # repo-sidebar-shell
    (
        r"\.repo-sidebar-shell \{[^}]*\}",
        """.repo-sidebar-shell {
  background: hsl(var(--card));
  border-color: hsl(var(--border));
}""",
    ),
    # glass-card.repo-sidebar-shell pseudo gradients
    (
        r"\.glass-card\.repo-sidebar-shell::before \{[^}]*\}",
        ".glass-card.repo-sidebar-shell::before {\n  content: none;\n}",
    ),
    (
        r"\.glass-card\.repo-sidebar-shell::after \{[^}]*\}",
        ".glass-card.repo-sidebar-shell::after {\n  content: none;\n}",
    ),
    (
        r"\.dark \.glass-card\.repo-sidebar-shell::after \{[^}]*\}",
        ".dark .glass-card.repo-sidebar-shell::after {\n  content: none;\n}",
    ),
    # glass-card::before gradients
    (
        r"\.glass-card::before \{[^}]*\}",
        ".glass-card::before {\n  content: none;\n}",
    ),
    (
        r"\.dark \.glass-card::before \{[^}]*\}",
        ".dark .glass-card::before {\n  content: none;\n}",
    ),
    # list-scroll-shell
    (
        r"\.list-scroll-shell \{[^}]*\}",
        """.list-scroll-shell {
  border-radius: 1rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
}""",
    ),
    # list-scroll-shell pseudo gradient
    (
        r"\.list-scroll-shell::before \{[^}]*\}",
        ".list-scroll-shell::before {\n  content: none;\n}",
    ),
    (
        r"\.dark \.list-scroll-shell::before \{[^}]*\}",
        ".dark .list-scroll-shell::before {\n  content: none;\n}",
    ),
]

# Order matters: more specific patterns first.
COMPONENT_REPLACEMENTS = [
    (r"bg-\[var\(--glass-panel-bg\)\]/30", "bg-background"),
    (r"bg-\[var\(--glass-bg\)\]/20", "bg-muted/20"),
    (r"bg-\[var\(--glass-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-bg-hover\)\]", "bg-accent"),
    (r"bg-\[var\(--glass-bg-active\)\]", "bg-accent/80"),
    (r"bg-\[var\(--glass-panel-bg\)\]", "bg-card"),
    (r"bg-\[var\(--glass-input-bg\)\]", "bg-background"),
    (r"bg-\[var\(--glass-icon-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-code-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-kbd-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-branch-connected-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-branch-disconnected-bg\)\]", "bg-muted"),
    (r"bg-\[var\(--glass-overlay\)\]", "bg-background/80"),
    (r"backdrop-blur-\[2px\]", ""),
    (r"backdrop-blur-none", ""),
    (r"backdrop-blur-0", ""),
    (r"backdrop-blur-sm", ""),
    (r"backdrop-blur-md", ""),
    (r"backdrop-blur-xl", ""),
]

# Specific string replacements for contexts where regex is too broad.
EXACT_REPLACEMENTS = {
    "components/ui/button.tsx": [
        (
            'border border-[var(--glass-border)] bg-[var(--glass-bg)] hover:bg-[var(--glass-bg-hover)] hover:text-accent-foreground backdrop-blur-sm',
            'border border-border bg-muted hover:bg-accent hover:text-accent-foreground',
        ),
        (
            'bg-[var(--glass-input-bg)] text-secondary-foreground hover:bg-[var(--glass-bg)] border border-[var(--glass-border-subtle)]',
            'bg-background text-secondary-foreground hover:bg-muted border border-input',
        ),
        (
            'hover:bg-[var(--glass-bg)] hover:text-accent-foreground',
            'hover:bg-muted hover:text-accent-foreground',
        ),
    ],
    "components/layout/MainContentShell.tsx": [
        (
            'bg-[var(--glass-panel-bg)]/30',
            'bg-background',
        ),
    ],
    "components/publish/PublishRunCard.tsx": [
        (
            'bg-background/48 backdrop-blur-[2px]',
            'bg-background/80',
        ),
    ],
}


def clean_spacing(content: str) -> str:
    # Collapse multiple spaces inside className strings; harmless outside too.
    return re.sub(r'  +', ' ', content)


def main() -> None:
    # --- CSS ---
    css_file = ROOT / "index.css"
    css = css_file.read_text(encoding="utf-8")
    for pattern, replacement in CSS_REPLACEMENTS:
        if not re.search(pattern, css):
            print(f"CSS pattern not found: {pattern[:80]}")
            continue
        css = re.sub(pattern, replacement, css, count=1)
    css_file.write_text(css, encoding="utf-8")
    print("updated src/index.css")

    # --- Components ---
    files = list(ROOT.rglob("*.tsx")) + list(ROOT.rglob("*.ts"))
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        content = path.read_text(encoding="utf-8")
        original = content

        for pattern, replacement in COMPONENT_REPLACEMENTS:
            content = re.sub(pattern, replacement, content)

        for old, new in EXACT_REPLACEMENTS.get(relative, []):
            content = content.replace(old, new)

        content = clean_spacing(content)

        if content != original:
            path.write_text(content, encoding="utf-8")
            print(f"updated {relative}")


if __name__ == "__main__":
    main()
