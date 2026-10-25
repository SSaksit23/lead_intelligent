import type { Metadata } from 'next';
import './styles.css';
export const metadata:Metadata={title:'GO365 · Lead Intelligence',description:'GO365 owner workspace — contacts, imports and travel history'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="th"><body>{children}</body></html>;}
