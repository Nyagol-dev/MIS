'use client';

import React, { useState, useEffect, useRef } from 'react';

interface ICD11Result {
  code: string;
  title: string;
}

export function ICD11Search({ onSelect }: { onSelect: (diagnosis: ICD11Result) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ICD11Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [favorites, setFavorites] = useState<ICD11Result[]>([
    { code: '1A00', title: 'Cholera' },
    { code: '1F40', title: 'Malaria' },
    { code: '9B71', title: 'Essential hypertension' },
    { code: '5A10', title: 'Type 1 diabetes mellitus' }
  ]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    
    const timeout = setTimeout(() => {
      setLoading(true);
      // Mock API call to ICD-11 search route
      fetch(`/api/clinical/diagnoses/search?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
          setResults(data.items || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 300);
    
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative w-full" ref={searchRef}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-slate-400">🔍</span>
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-500 focus:outline-none focus:placeholder-slate-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition duration-150 ease-in-out shadow-sm"
          placeholder="Search ICD-11 code or diagnosis..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
        />
        {loading && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <span className="text-xs text-slate-400">Loading...</span>
          </div>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-white shadow-lg max-h-60 rounded-md py-1 text-base ring-1 ring-black ring-opacity-5 overflow-auto focus:outline-none sm:text-sm">
          {query.length < 2 ? (
            <div className="px-3 py-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Favorites</p>
              <ul>
                {favorites.map(fav => (
                  <li 
                    key={fav.code} 
                    className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-slate-100 rounded text-slate-900"
                    onClick={() => {
                      onSelect(fav);
                      setShowDropdown(false);
                      setQuery('');
                    }}
                  >
                    <span className="font-mono bg-slate-200 text-slate-700 px-1 py-0.5 rounded text-xs mr-2">{fav.code}</span>
                    <span className="truncate font-medium">{fav.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : results.length > 0 ? (
            <ul>
              {results.map(res => (
                <li 
                  key={res.code} 
                  className="cursor-pointer select-none relative py-2 pl-3 pr-9 hover:bg-slate-100 text-slate-900"
                  onClick={() => {
                    onSelect(res);
                    setShowDropdown(false);
                    setQuery('');
                  }}
                >
                  <span className="font-mono bg-blue-100 text-blue-800 border border-blue-200 px-1 py-0.5 rounded text-xs mr-2">{res.code}</span>
                  <span className="truncate">{res.title}</span>
                </li>
              ))}
            </ul>
          ) : !loading ? (
            <div className="cursor-default select-none relative py-2 pl-3 pr-9 text-slate-500">
              No diagnoses found for "{query}"
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
