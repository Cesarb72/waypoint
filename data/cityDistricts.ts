import type { CityDistrict } from '../types/cityDistrict';

export type City = {
  id: string;
  name: string;
  slug: string;
  description: string;
};

export const CITIES: City[] = [
  {
    id: 'san-jose',
    name: 'San Jose',
    slug: 'san-jose',
    description: 'A mix of late-night bites, patios, and low-key hangouts in the South Bay.',
  },
];

export const CITY_DISTRICTS: CityDistrict[] = [
  {
    id: 'sj-downtown',
    cityId: 'san-jose',
    name: 'Downtown',
    slug: 'downtown',
    description:
      'Neon, food halls, and quick hops between bars, music venues, and coffee counters.',
    featuredPlanIds: ['district_sj_downtown_1', 'district_sj_downtown_2'],
  },
  {
    id: 'sj-willow-glen',
    cityId: 'san-jose',
    name: 'Willow Glen',
    slug: 'willow-glen',
    description:
      'Tree-lined streets with cozy restaurants, ice cream, and a slower pace after dark.',
    featuredPlanIds: ['district_sj_willow_1'],
  },
  {
    id: 'sj-santana-row',
    cityId: 'san-jose',
    name: 'Santana Row',
    slug: 'santana-row',
    description:
      'Walkable luxury shops, polished dining, and patio lounges that stay lively late.',
    featuredPlanIds: [],
  },
];

export function getCityById(id: string): City | undefined {
  return CITIES.find((city) => city.id === id);
}

export function getCityBySlug(slug: string): City | undefined {
  return CITIES.find((city) => city.slug === slug);
}

export function getDistrictBySlug(slug: string): CityDistrict | undefined {
  return CITY_DISTRICTS.find((district) => district.slug === slug);
}

export function getDistrictsForCity(cityId: string): CityDistrict[] {
  return CITY_DISTRICTS.filter((district) => district.cityId === cityId);
}
