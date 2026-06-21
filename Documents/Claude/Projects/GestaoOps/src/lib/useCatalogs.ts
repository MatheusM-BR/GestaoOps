'use client';

import { useEffect, useState } from 'react';
import {
  fetchBreeds,
  fetchBreedTypes,
  fetchPartners,
  fetchUnities,
  fetchBidIncrementGroups,
  fetchStreamings,
  fetchChannels,
} from '@/services/remateweb-api';
import type {
  Breed,
  BreedType,
  Partner,
  Unity,
  BidIncrementGroup,
  Streaming,
  Channel,
} from '@/types/catalog';

export interface Catalogs {
  breeds: Breed[];
  breedTypes: BreedType[];
  partners: Partner[];
  eventMakers: Partner[];   // parceiros com eventMaker = true (leiloeiras)
  channels: Channel[];
  unities: Unity[];
  bidIncrementGroups: BidIncrementGroup[];
  streamings: Streaming[];
}

const EMPTY: Catalogs = {
  breeds: [],
  breedTypes: [],
  partners: [],
  eventMakers: [],
  channels: [],
  unities: [],
  bidIncrementGroups: [],
  streamings: [],
};

// Cache em módulo: os catálogos mudam pouco, então uma carga por sessão basta.
let cache: Catalogs | null = null;
let inflight: Promise<Catalogs> | null = null;

async function loadCatalogs(): Promise<Catalogs> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const [breeds, breedTypes, partners, channelsRes, unities, bidIncrementGroups, streamings] =
      await Promise.all([
        fetchBreeds().catch(() => [] as Breed[]),
        fetchBreedTypes().catch(() => [] as BreedType[]),
        fetchPartners().catch(() => [] as Partner[]),
        fetchChannels().catch(() => ({ channels: [] as Channel[] })),
        fetchUnities().catch(() => [] as Unity[]),
        fetchBidIncrementGroups().catch(() => [] as BidIncrementGroup[]),
        fetchStreamings().catch(() => [] as Streaming[]),
      ]);

    const result: Catalogs = {
      breeds,
      breedTypes,
      partners,
      eventMakers: partners.filter((p) => p.eventMaker),
      channels: channelsRes.channels ?? [],
      unities,
      bidIncrementGroups,
      streamings,
    };
    cache = result;
    inflight = null;
    return result;
  })();

  return inflight;
}

// Força recarga no próximo uso (ex: após editar um catálogo).
export function invalidateCatalogs(): void {
  cache = null;
  inflight = null;
}

export function useCatalogs(): { catalogs: Catalogs; loading: boolean; error: string | null } {
  const [catalogs, setCatalogs] = useState<Catalogs>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // loadCatalogs() resolve o cache imediatamente (como promise) quando já
    // carregado, então o setState acontece sempre de forma assíncrona.
    loadCatalogs()
      .then((c) => {
        if (active) {
          setCatalogs(c);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Falha ao carregar catálogos');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { catalogs, loading, error };
}
