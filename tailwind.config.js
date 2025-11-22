/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#ecf8f6",
          100: "#d5f0eb",
          200: "#aee2d8",
          300: "#84d3c4",
          400: "#56c1ae",
          500: "#2fa793",
          600: "#128574",   // <- primary (matches your FCC green tone)
          700: "#0f6f62",
          800: "#0e5a50",
          900: "#0d4b43",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 24px rgba(15, 23, 42, 0.06)",
      },
      container: { center: true, padding: "1rem" },
    },
  },
  plugins: [],
};
