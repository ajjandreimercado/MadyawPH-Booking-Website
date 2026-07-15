import type { Dispatch, SetStateAction } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { Check, Star } from 'lucide-react';
import type { FilterState } from '../../types';

interface FilterSidebarProps {
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  totalResults: number;
  propertyTypes: string[];
  amenities: string[];
}

export default function FilterSidebar({ filters, setFilters, totalResults, propertyTypes, amenities }: FilterSidebarProps) {
  
  const handleTypeToggle = (type: string) => {
    setFilters(prev => ({
      ...prev,
      types: prev.types.includes(type) 
        ? prev.types.filter(t => t !== type)
        : [...prev.types, type]
    }));
  };

  const handleStarToggle = (stars: number) => {
    setFilters(prev => ({
      ...prev,
      rating: prev.rating === stars ? 0 : stars // Toggle or set
    }));
  };

  const handleAmenityToggle = (amenity: string) => {
    setFilters(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity]
    }));
  };

  return (
    <div className="w-full lg:w-64 flex-shrink-0 bg-brand-cream p-6 rounded-3xl border border-brand-primary/10 shadow-md flex flex-col h-full overflow-hidden space-y-6">
      {/* Search Header */}
      <div>
        <h3 className="font-serif italic text-xl mb-2 text-brand-dark">Refine Search</h3>
        <p className="text-xs text-brand-dark font-bold">Showing {totalResults} properties</p>
      </div>

      <div className="h-px bg-brand-secondary/30" />

      {/* Price Range */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase font-bold tracking-widest mb-3 text-brand-dark">Price Nightly</p>
        <div className="pt-2 px-1">
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5 cursor-pointer"
            defaultValue={[0, 10000]}
            max={10000}
            step={50}
            min={0}
            value={filters.priceRange}
            onValueChange={(val) => setFilters(prev => ({ ...prev, priceRange: val }))}
          >
            <Slider.Track className="bg-brand-secondary/25 relative grow rounded-full h-1">
              <Slider.Range className="absolute bg-brand-primary rounded-full h-full" />
            </Slider.Track>
            <Slider.Thumb className="block w-3 h-3 bg-brand-primary shadow-sm rounded-full hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream transition-transform" />
            <Slider.Thumb className="block w-3 h-3 bg-brand-primary shadow-sm rounded-full hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-cream transition-transform" />
          </Slider.Root>
          <div className="flex justify-between items-center mt-3 text-[10px] font-bold text-brand-dark">
            <span>${filters.priceRange[0]}</span>
            <span>${filters.priceRange[1]}</span>
          </div>
        </div>
      </div>

      <div className="h-px bg-brand-secondary/30" />

      {/* Property Type */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase font-bold tracking-widest mb-3 text-brand-dark">Property Type</p>
        <div className="space-y-2">
          {propertyTypes.map((type) => (
            <label key={type} className={`flex items-center gap-3 cursor-pointer group text-xs transition-colors font-bold rounded-lg px-1 py-0.5 -mx-1 focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-primary/20 focus-within:ring-offset-2 focus-within:ring-offset-brand-background ${filters.types.includes(type) ? 'text-brand-primary' : 'text-brand-dark hover:text-brand-primary'}`}>
              <div className={`relative flex items-center justify-center w-4 h-4 rounded-[3px] border transition-colors ${filters.types.includes(type) ? 'border-brand-primary bg-brand-primary' : 'border-brand-dark/40 bg-white group-hover:border-brand-primary'}`}>
                <input 
                  type="checkbox" 
                  className="sr-only" 
                  checked={filters.types.includes(type)}
                  onChange={() => handleTypeToggle(type)}
                />
                {filters.types.includes(type) && <Check className="w-3 h-3 text-white z-10" />}
              </div>
              <span>{type}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="h-px bg-brand-secondary/30" />

      {/* Star Rating */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase font-bold tracking-widest mb-3 text-brand-dark">Star Rating</p>
        <div className="space-y-2">
          {[5, 4, 3].map((stars) => {
            const isChecked = filters.rating === stars;
            return (
              <label key={stars} className={`flex items-center gap-3 cursor-pointer group text-xs transition-colors font-bold rounded-lg px-1 py-0.5 -mx-1 focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-primary/20 focus-within:ring-offset-2 focus-within:ring-offset-brand-background ${isChecked ? 'text-brand-primary' : 'text-brand-dark hover:text-brand-primary'}`}>
                <div className={`relative flex items-center justify-center w-4 h-4 rounded-[3px] border transition-colors ${isChecked ? 'border-brand-primary bg-brand-primary' : 'border-brand-dark/40 bg-white group-hover:border-brand-primary'}`}>
                  <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={isChecked}
                    onChange={() => handleStarToggle(stars)}
                  />
                  {isChecked && <Check className="w-3 h-3 text-white z-10" />}
                </div>
                <span className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`w-3 h-3 ${i < stars ? 'fill-brand-primary text-brand-primary' : 'fill-brand-secondary/20 text-brand-secondary/30'}`}
                    />
                  ))}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-brand-secondary/30" />

      {/* Amenities */}
      <div className="space-y-3">
        <p className="text-[10px] uppercase font-bold tracking-widest mb-3 text-brand-dark">Amenities</p>
        <div className="space-y-2">
          {amenities.map((amenity) => {
             const isChecked = filters.amenities.includes(amenity);
             return (
              <label key={amenity} className={`flex items-center gap-3 cursor-pointer group text-xs transition-colors font-bold rounded-lg px-1 py-0.5 -mx-1 focus-within:outline-none focus-within:ring-2 focus-within:ring-brand-primary/20 focus-within:ring-offset-2 focus-within:ring-offset-brand-background ${isChecked ? 'text-brand-primary' : 'text-brand-dark hover:text-brand-primary'}`}>
                <div className={`relative flex items-center justify-center w-4 h-4 rounded-[3px] border transition-colors ${isChecked ? 'border-brand-primary bg-brand-primary' : 'border-brand-dark/40 bg-white group-hover:border-brand-primary'}`}>
                  <input 
                    type="checkbox" 
                    className="sr-only" 
                    checked={isChecked}
                    onChange={() => handleAmenityToggle(amenity)}
                  />
                  {isChecked && <Check className="w-3 h-3 text-white z-10" />}
                </div>
                <span>{amenity}</span>
              </label>
             )
          })}
        </div>
      </div>
    </div>
  );
}
