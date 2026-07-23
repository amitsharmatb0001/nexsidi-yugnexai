import type { Metadata } from "next";
import "@yugnex/nexui/nexui-utils.css";
import { NexuiProvider } from "@yugnex/nexui-react/provider";
import { ToastProvider, Toaster } from "@yugnex/nexui-react/toast";

export const metadata: Metadata = {
  title: "NexSidi — Autonomous Software Business Operator",
  description: "Describe your idea. Get a working app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.bunny.net" />
        <link
          href="https://fonts.bunny.net/css?family=space-grotesk:500,600,700,800|inter:400,500,600|jetbrains-mono:400,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NexuiProvider theme="void">
          <ToastProvider>
            <Toaster />
            {children}
          </ToastProvider>
        </NexuiProvider>
      </body>
    </html>
  );
}
