const posterCards = Array.from({ length: 7 }, (_, index) => index);
const landscapeCards = Array.from({ length: 4 }, (_, index) => index);

export function V4HomepageSkeleton() {
  return (
    <>
      <section className="v4-content-section" id="today-recommendations" aria-label="今日推荐">
        <div className="v4-section-heading">
          <h2>今日推荐 <span aria-hidden="true">›</span></h2>
          <a href="#today-recommendations">查看更多 <span aria-hidden="true">›</span></a>
        </div>
        <div className="v4-poster-row" aria-label="推荐海报布局预览">
          {posterCards.map((item) => (
            <div className="v4-poster-skeleton" key={item}>
              <span />
            </div>
          ))}
        </div>
      </section>

      <section className="v4-content-section v4-continue-section" id="continue-watching" aria-label="继续观看">
        <div className="v4-section-heading">
          <h2>继续观看 <span aria-hidden="true">›</span></h2>
        </div>
        <div className="v4-landscape-row">
          {landscapeCards.map((item) => (
            <div className="v4-landscape-skeleton" key={item}>
              <div className="v4-landscape-image"><span /></div>
              <div className="v4-landscape-meta"><i /><i /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
