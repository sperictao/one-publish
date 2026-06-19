/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        interactive: {
          DEFAULT: "hsl(var(--interactive))",
          foreground: "hsl(var(--interactive-foreground))",
          hover: "hsl(var(--interactive-hover))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      // Geist radii: 6px everyday, 12px menus/modals, 16px fullscreen.
      borderRadius: {
        none: "0px",
        sm: "6px",
        md: "12px",
        lg: "16px",
        full: "9999px",
      },
      // Geist elevation — tonal surfaces + borders first, shadows stay subtle.
      boxShadow: {
        raised:
          "0 2px 2px rgba(0, 0, 0, 0.04)",
        popover:
          "0 1px 1px rgba(0, 0, 0, 0.02), 0 4px 8px -4px rgba(0, 0, 0, 0.04), 0 16px 24px -8px rgba(0, 0, 0, 0.06)",
        modal:
          "0 1px 1px rgba(0, 0, 0, 0.02), 0 8px 16px -4px rgba(0, 0, 0, 0.04), 0 24px 32px -8px rgba(0, 0, 0, 0.06)",
        inset: "inset 0 1px 2px rgba(0, 0, 0, 0.04)",
      },
      fontFamily: {
        sans: [
          "Geist-Variable",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          "GeistMono-Variable",
          "ui-monospace",
          "SFMono-Regular",
          '"SF Mono"',
          "Consolas",
          '"Liberation Mono"',
          "Menlo",
          "monospace",
        ],
      },
      // Geist motion: only when it clarifies a change. Short, physical easing.
      animation: {
        "fade-in": "fadeIn 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.1)",
        "slide-up": "slideUp 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      transitionTimingFunction: {
        geist: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",
      },
    },
  },
  plugins: [],
};
