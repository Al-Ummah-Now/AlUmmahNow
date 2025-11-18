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
    },
  },
  variants: {
    extend: {
      backgroundColor: ['hover'],
    },
  },
  plugins: [
    require("@tailwindcss/aspect-ratio"),
    function({ addUtilities }: any) {
      const newUtilities = {
        '.scrollbar-hide': {
          /* IE and Edge */
          '-ms-overflow-style': 'none',
          /* Firefox */
          'scrollbar-width': 'none',
          /* Safari and Chrome */
          '&::-webkit-scrollbar': {
            display: 'none'
          }
        }
      }
      addUtilities(newUtilities)
    }
  ],
};

export default module;
