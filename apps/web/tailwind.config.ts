/** @type {import('tailwindcss').Config} */

module.exports = {
  darkmode: "class",
  content: [
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    fontfamily: {
      farsi: ["Farsi Simple Bold"],
    },
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        ummah: {
          text: "#000000",
          label: "#aaaaaa",
          bg: "#ffffff",
          50: "#ffa037",
          100: "#f6e196",
          150: "#8e6c53",
          400: "#888888",
          500: "#092735",
          900: "#091f29",
        },
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-out',
      },
    },
  },
  variants: {
    extend: {
      backgroundColor: ['hover'],
    },
  },
  plugins: [
    require("@tailwindcss/aspect-ratio"), // Add this plugin
  ],
};

export default module;
