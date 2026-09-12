import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const resizeObserverLoopGuard = `
(() => {
  const ignored = new Set([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ]);
  const isIgnored = (message) =>
    typeof message === "string" && ignored.has(message);

  window.addEventListener("error", (event) => {
    if (!isIgnored(event.message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason && reason.message ? reason.message : String(reason || "");
    if (!isIgnored(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Where am I",
  description: "Visualize how code changes affect files, APIs, services, databases, and tests across repositories.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{ __html: resizeObserverLoopGuard }}
          suppressHydrationWarning
        />
        {children}
      </body>
    </html>
  );
}
