/** @type {import('tailwindcss').Config} */

module.exports = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/providers/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Admin-specific colors
        admin: {
          primary: '#3b82f6',    // blue-500
          secondary: '#6b7280',  // gray-500
          success: '#22c55e',    // green-500
          warning: '#f59e0b',    // amber-500
          danger: '#ef4444',     // red-500
        },
      },
    },
  },
  plugins: [],
};

export default module;
