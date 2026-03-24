import "./globals.css";

export const metadata = {
  title: "SyncRoom — Watch Together, Stay in Sync",
  description:
    "Create a room, paste a YouTube link, invite friends, and watch videos in perfect sync with live chat. The ultimate watch party experience.",
  keywords:
    "watch party, sync video, watch together, youtube sync, watch with friends",
  openGraph: {
    title: "SyncRoom — Watch Together, Stay in Sync",
    description:
      "The ultimate watch party experience. Perfect video sync with live chat.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#0b0c0f" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>▶️</text></svg>" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
