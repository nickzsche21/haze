import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "HAZE — virtual smoke, real breath";
const description =
  "Blow smoke rings through your webcam. Purse your lips to drag, hold it, exhale. Ghost inhales, French inhales and full dragons, tracked from your face in the browser.";

export const metadata: Metadata = {
  title,
  description,
  applicationName: "HAZE",
  metadataBase: new URL("https://haze.vercel.app"),
  openGraph: { title, description, type: "website", siteName: "HAZE" },
  twitter: { card: "summary_large_image", title, description },
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#06070a"/><circle cx="16" cy="21" r="4.5" fill="#ff6a2b"/><circle cx="16" cy="21" r="8" fill="#ff6a2b" opacity=".22"/><path d="M13 13c4-2 1-5 3-8" stroke="#e8d9c0" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M19 13c4-2 1-5 3-8" stroke="#e8d9c0" stroke-width="2" fill="none" stroke-linecap="round" opacity=".5"/></svg>`,
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
