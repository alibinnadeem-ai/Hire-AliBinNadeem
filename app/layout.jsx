export const metadata = {
  title: 'Ali Bin Nadeem - Technology Consultant · Entrepreneur · Leader',
  description: 'Technology Consultant portfolio for Ali Bin Nadeem.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
