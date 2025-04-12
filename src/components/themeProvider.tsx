"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { ThemeProvider as MaterialThemeProvider } from "@material-tailwind/react";

export function ThemeProvider({
    children,
    ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
    return <MaterialThemeProvider value={{}}>
        <NextThemesProvider {...props}>
            {children}
        </NextThemesProvider>
    </MaterialThemeProvider>
}