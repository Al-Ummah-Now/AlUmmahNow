import { text } from "stream/consumers";
import type { Config } from "tailwindcss";

const withMT = require("@material-tailwind/react/utils/withMT");

const theme = {
  component: {
    defaultProps: {},
    colors: {
      ummah: {
        text: "#ffa037",
        label: "#8e6c53",
        bg: "#091f29",
        50: "#ffa037",
        100: "#f6e196",
        150: "#8e6c53",
        400: "#093041",
        500: "#092735",
        900: "#091f29",
      }
    }
  }
}

module.exports = withMT({
  darkmode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
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
  plugins: [],
});

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default module;
