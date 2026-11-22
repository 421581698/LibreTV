// Official TMDB brand mark and attribution required for API-powered artwork.
const TMDB_LOGO = 'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg';

export function TmdbAttribution() {
  return (
    <aside className="ipad-edition__tmdb-attribution" aria-label="影视资料来源与致谢">
      <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" aria-label="访问 The Movie Database">
        <img src={TMDB_LOGO} alt="The Movie Database (TMDB)" loading="lazy" />
      </a>
      <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </aside>
  );
}
