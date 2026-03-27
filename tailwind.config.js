/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          900: "#1e3a8a",
        },
      },
      // Larger touch targets for iPad/iPhone
      minHeight: {
        touch: "44px",
      },
      fontSize: {
        "touch-base": ["17px", "24px"],
      },
    },
  },
  plugins: [],
};
