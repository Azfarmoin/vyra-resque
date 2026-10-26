<<<<<<< HEAD
import type { Metadata, Viewport } from "next"
import { Fraunces, Hanken_Grotesk } from "next/font/google"
import "leaflet/dist/leaflet.css"
import "./globals.css"
import SyncStatus from "@/components/SyncStatus"
import PwaRegister from "@/components/PwaRegister"

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["SOFT", "opsz"] })
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body", display: "swap" })

export const metadata: Metadata = {
  applicationName: "VYRA",
  title: "VYRA — Vulnerability, Yielded Response & Assistance",
  description: "Ask for help in about a minute. Responders see the most urgent cases first, with the reasons why.",
  appleWebApp: { capable: true, title: "VYRA", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
}

export const viewport: Viewport = { themeColor: "#F6F0E7" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-sans antialiased">
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
        <SyncStatus />
        <PwaRegister />
=======
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "leaflet/dist/leaflet.css"
import "./globals.css"
import SyncStatus from "@/components/SyncStatus"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "ResQNet - Intelligent Disaster Response",
  description: "Finding Who Needs Help Most",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <SyncStatus />
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
      </body>
    </html>
  )
}
