import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { Appearance } from "@/components/Appearance";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Our spending",
  description: "Shared household spending tracker",
  applicationName: "Our spending",
  appleWebApp: { capable: true, title: "Spending", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Stops iOS zooming into 15px inputs; pinch-zoom still works on iOS.
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F4" },
    { media: "(prefers-color-scheme: dark)", color: "#111315" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html suppressHydrationWarning lang="en-AU" className={`${dmSans.variable} ${spaceGrotesk.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('our-spending-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'system'}catch(e){}})()` }} />
      </head>
      <body>
        <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-bg">{children}</div>
        <Appearance />
        <ServiceWorker />
      </body>
    </html>
  );
}
