/** @type {import('tailwindcss').Config} */
export default {
  content: ["./popup.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        display: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
      colors: {
        ink: {
          DEFAULT: "#111114",
          soft: "#3a3a40",
          muted: "#8a8a92",
        },
        mist: {
          DEFAULT: "#f6f6f7",
          card: "#ffffff",
          line: "#e8e8ec",
        },
        accent: {
          DEFAULT: "#111114",
          soft: "#2b2b31",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,17,20,0.04), 0 8px 24px rgba(17,17,20,0.06)",
        pop: "0 12px 40px rgba(17,17,20,0.14)",
      },
      animation: {
        "fade-in": "fadeIn 240ms ease-out",
        "slide-up": "slideUp 260ms cubic-bezier(0.16, 1, 0.3, 1)",
        "spin-slow": "spin 1.1s linear infinite",
        "shimmer": "shimmer 1.6s linear infinite",
        "pulse-ring": "pulseRing 1.8s ease-out infinite",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "80%, 100%": { transform: "scale(1.25)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
