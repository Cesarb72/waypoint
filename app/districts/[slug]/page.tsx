import { notFound } from 'next/navigation';
import DistrictView from '@/app/surfaces/DistrictView';
import { getCityById, getDistrictBySlug } from '../../data/cityDistricts';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function DistrictPage({ params }: PageProps) {
  const { slug } = await params;
  if (!slug) {
    notFound();
  }
  const district = getDistrictBySlug(slug);
  if (!district) {
    notFound();
  }
  const city = getCityById(district.cityId);
  if (!city) {
    notFound();
  }
  return <DistrictView district={district} city={city} />;
}
