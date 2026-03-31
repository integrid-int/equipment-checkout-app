/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#E8E8FF",
          100: "#d7d6fe",
          300: "#9B9EFC",
          500: "#5E59FA",
          600: "#4D48D9",
          700: "#3E42AF",
          900: "#16192C",
        },
        accent: {
          300: "#85E7FF",
          500: "#0ACFFF",
          700: "#1A82B6",
        },
      },
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
        mono: ["Chivo Mono", "ui-monospace", "monospace"],
      },
      borderColor: {
        DEFAULT: "#dfdefe",
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
