'use client';
import dynamic from 'next/dynamic';

const LaberintoFantasmaConfigurator = dynamic(
  () => import('@/components/LaberintoFantasmaConfigurator'),
  { ssr: false }
);

export default function Page() {
  return <LaberintoFantasmaConfigurator />;
}
