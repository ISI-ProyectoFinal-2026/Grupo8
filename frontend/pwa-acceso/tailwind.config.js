/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Poppins en las tres apps (se carga desde @fontsource/poppins en main.tsx)
      fontFamily: {
        sans: ["Poppins", "system-ui", "sans-serif"],
      },
      colors: {
        // Paleta de la 24.5. Cada par de texto y fondo que se usa tiene contraste de al menos 4,5:1
        // (ver docs/ux-ui/estilo.md). "tierra" son los neutros cálidos; "bosque", los verdes.
        tierra: {
          50: "#FAF8F6",
          100: "#F3F0EC",
          200: "#E8E3DD",
          300: "#D7CFC6",
          400: "#A99D91",
          500: "#655B52",
          600: "#5E554C",
          700: "#4E463E",
          800: "#3F3730",
          900: "#2F2822",
          950: "#1E1915",
        },
        bosque: {
          50: "#F1F7F1",
          100: "#E1EEE2",
          200: "#C3DDC5",
          300: "#94C29A",
          400: "#6DAF75",
          500: "#2F7D3A",
          600: "#1F5C26",
          700: "#184B1E",
          800: "#123A17",
          900: "#0D2A11",
          950: "#08190A",
        },
        // Barra lateral del panel
        lateral: "#233826",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}