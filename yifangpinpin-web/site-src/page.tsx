import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import type { PublicProperty } from "@/types/db";
import { SiteListings } from "@/components/site/SiteListings";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "易房拼拼 · 立足深圳，放眼大湾区 — 让买房更简单",
  description:
    "易房拼拼：以笋度评分为核心的大湾区笋盘代理与房产金融服务。真房源、真笋盘、真服务，做让用户放心靠谱的笋盘代理人。",
};

function discount(price: number | null, ref: number | null): number | null {
  if (!price || !ref || ref <= price) return null;
  return Math.round(((ref - price) / ref) * 1000) / 10;
}

export default async function Home() {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("public_properties")
    .select("*")
    .order("sun_score", { ascending: false });
  const listings = (data ?? []) as PublicProperty[];
  const hero = listings[0] ?? null;
  const heroDisc = hero ? discount(hero.listing_price, hero.reference_price) : null;

  return (
    <div className="yfp-site">
      {/* 顶栏 */}
      <header className="site-header">
        <div className="wrap nav">
          <a className="brand" href="#top">
            <span className="brand-mark">
              <img src="/assets/logo.png" alt="易房拼拼" width={44} height={44} />
            </span>
            <span className="brand-text">
              <span className="brand-name">
                易房<b>拼拼</b>
              </span>
              <span className="brand-tag">让买房更简单</span>
            </span>
          </a>
          <nav className="nav-links">
            <a href="#match">笋盘匹配</a>
            <a href="#loan">贷款服务</a>
            <a href="#listings">笋盘精选</a>
            <a href="#about">关于我们</a>
            <a href="#culture">企业文化</a>
          </nav>
          <div className="nav-cta">
            <Link className="btn btn-ghost" href="/m/login">
              登录
            </Link>
            <Link className="btn btn-primary" href="/m">
              进入平台 · 找笋盘
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="hero" id="top">
        <div className="wrap hero-inner">
          <div className="hero-left">
            <span className="hero-badge">
              <span className="dot" />
              粤港澳大湾区 · 笋盘代理 × 房产金融
            </span>
            <h1 className="balance">
              立足深圳<span className="sep">·</span>放眼大湾区
            </h1>
            <p className="hero-sub">做让用户放心靠谱的笋盘代理人</p>
            <p className="hero-desc">
              用数据为每一套房源打出「笋度」分，帮你找到真正低于市场价、产权清晰、可放心入手的好房；并为你对接银行与持牌机构的房产金融贷款方案。
            </p>
            <div className="hero-cta">
              <Link className="btn btn-gold" href="/m">
                立即找笋盘
              </Link>
              <Link className="btn btn-ghost on-dark" href="/m/loan">
                房产金融贷款
              </Link>
            </div>
            <div className="hero-trust">
              <div className="ht">
                <b>{listings.length || "11"}+</b>
                <span>在售笋盘</span>
              </div>
              <div className="ht">
                <b>9</b>
                <span>大湾区城市</span>
              </div>
              <div className="ht">
                <b>100</b>
                <span>分笋度体系</span>
              </div>
              <div className="ht">
                <b>0</b>
                <span>注水房源</span>
              </div>
            </div>
          </div>
          <div className="hero-right">
            {hero ? (
              <Link href={`/m/p/${hero.id}`} className="hero-card" style={{ display: "block" }}>
                <div className="hc-top">
                  <span className="hc-tag">急售 · 今日推荐</span>
                  <span className="sun-badge">
                    <b>{hero.sun_score}</b>
                    <span>笋度</span>
                  </span>
                </div>
                <div className="hc-title">{hero.title}</div>
                <div className="hc-meta">
                  {[hero.district, hero.community, hero.layout, hero.area_sqm ? `${hero.area_sqm}㎡` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="hc-price">
                  <b>
                    {hero.listing_price ?? "—"}
                    <small style={{ fontSize: 16 }}>万</small>
                  </b>
                  {hero.reference_price && hero.reference_price > (hero.listing_price ?? 0) ? (
                    <s>市场价 {hero.reference_price}万</s>
                  ) : null}
                </div>
                {heroDisc ? <span className="hc-disc">低于市场价 {heroDisc}%</span> : null}
                <div className="hc-bar">
                  <span className="chip">产权清晰</span>
                  <span className="chip">已核验</span>
                  <span className="chip">业主急售</span>
                  <span className="chip">带租约</span>
                </div>
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {/* 城市带 */}
      <div className="cities">
        <div className="cities-track">
          <span>深圳 香港 广州 珠海 东莞 佛山 惠州 中山 江门 肇庆 澳门</span>
          <span>深圳 香港 广州 珠海 东莞 佛山 惠州 中山 江门 肇庆 澳门</span>
        </div>
      </div>

      {/* 双业务 */}
      <section className="sec-pad" id="match">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Core Services</span>
            <div className="gold-rule" />
            <h2>两件事，我们做到极致</h2>
            <p>帮你买到对的房，帮你拿到合适的钱 —— 笋盘匹配与房产金融，一站打通。</p>
          </div>
          <div className="duo">
            <div className="svc match">
              <div className="svc-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="#D8323B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                  <path d="M11 8v6M8 11h6" />
                </svg>
              </div>
              <h3>笋盘智能匹配</h3>
              <p className="lead">
                不是房源越多越好，而是每一套都值得看。我们用「笋度」给房源打分，把真正的笋盘推到你面前。
              </p>
              <ul>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>笋度评分体系</b>：价格折扣、急迫度、产权状态、核验情况四维打分，0–100 一眼看懂笋不笋。
                  </span>
                </li>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>AI 需求匹配</b>：说出预算、区域、户型偏好，系统在大湾区房源库里为你筛出最匹配的几套。
                  </span>
                </li>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>真房源核验</b>：产权、价格、折扣全透明，注水房源一律不上架。
                  </span>
                </li>
              </ul>
              <a className="btn btn-primary" href="#listings">
                查看精选笋盘
              </a>
            </div>
            <div className="svc loan" id="loan">
              <div className="svc-ic">
                <svg viewBox="0 0 24 24" fill="none" stroke="#C8901F" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="18" height="13" rx="2" />
                  <path d="M3 10h18" />
                  <circle cx="8" cy="14.5" r="1.6" />
                </svg>
              </div>
              <h3>房产金融贷款</h3>
              <p className="lead">买房的钱、周转的钱，我们帮你对接银行与持牌机构，给得出能落地的方案。</p>
              <ul>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>按揭 / 房抵 / 经营贷</b>：首套二套按揭、住宅商铺抵押、企业主经营贷，多通道比价。
                  </span>
                </li>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>赎楼 &amp; 转贷</b>：过桥赎楼、低息转贷，缩短交易周期，省下利息差。
                  </span>
                </li>
                <li>
                  <span className="tick">✓</span>
                  <span>
                    <b>大湾区银行资源</b>：深耕本地一手政策与放款渠道，方案清晰、利率透明、放款高效。
                  </span>
                </li>
              </ul>
              <Link className="btn btn-gold" href="/m/loan">
                免费贷款咨询
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 笋度体系 */}
      <section className="sec-pad score">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Sun-Score System</span>
            <div className="gold-rule" />
            <h2>什么是「笋度」？</h2>
            <p>「笋盘」就是远低于市场价的好房。笋度，是我们给每套房源算出的一个分数 —— 越高越笋。</p>
          </div>
          <div className="score-grid">
            <div className="score-visual">
              <div className="score-ring">
                <svg viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={14} />
                  <circle
                    cx="100"
                    cy="100"
                    r="86"
                    fill="none"
                    stroke="#FFD466"
                    strokeWidth={14}
                    strokeLinecap="round"
                    strokeDasharray="540"
                    strokeDashoffset="135"
                  />
                </svg>
                <div className="num">
                  <b>100</b>
                  <span>满分</span>
                </div>
              </div>
              <div className="score-label">价格 50 · 急迫 20 · 产权 15 · 核验 15</div>
            </div>
            <div className="score-items">
              <div className="si-row">
                <div className="si-top">
                  <b>价格折扣</b>
                  <em>50 分</em>
                </div>
                <div className="si-desc">相对市场参考价的折扣越深，分数越高 —— 这是笋盘最核心的指标。</div>
                <div className="si-bar">
                  <i style={{ width: "100%" }} />
                </div>
              </div>
              <div className="si-row">
                <div className="si-top">
                  <b>急迫程度</b>
                  <em>20 分</em>
                </div>
                <div className="si-desc">业主越急售（移民、资金周转、置换），可谈空间越大。</div>
                <div className="si-bar">
                  <i style={{ width: "40%" }} />
                </div>
              </div>
              <div className="si-row">
                <div className="si-top">
                  <b>产权状态</b>
                  <em>15 分</em>
                </div>
                <div className="si-desc">满五唯一、产权清晰、无抵押纠纷的房源更让人放心。</div>
                <div className="si-bar">
                  <i style={{ width: "30%" }} />
                </div>
              </div>
              <div className="si-row">
                <div className="si-top">
                  <b>核验情况</b>
                  <em>15 分</em>
                </div>
                <div className="si-desc">经纪人实地核验、材料齐全的房源，才会标为「已核验」。</div>
                <div className="si-bar">
                  <i style={{ width: "30%" }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 笋盘精选 */}
      <section className="sec-pad listings" id="listings">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow" style={{ color: "var(--yfp-gold)" }}>
              Featured Listings
            </span>
            <div className="gold-rule" />
            <h2>大湾区笋盘精选</h2>
            <p>真实在售房源，按笋度由高到低排序。点筛选看不同类型。</p>
          </div>
          <SiteListings listings={listings} />
          <div className="more">
            <Link className="btn btn-gold" href="/m/demand">
              联系顾问 · 获取完整房源清单
            </Link>
          </div>
        </div>
      </section>

      {/* 关于我们 */}
      <section className="sec-pad" id="about">
        <div className="wrap about-grid">
          <div className="about-copy">
            <span className="eyebrow">About 易房拼拼</span>
            <h2>
              立足深圳，
              <br />
              放眼大湾区
            </h2>
            <p className="lead">我们是一家以「笋盘代理」为核心的地产金融服务机构。</p>
            <p>
              买房，是大多数家庭一生中最重的一笔决定。可信息不对称、价格不透明、房源真假难辨，让本该慎重的事变得焦虑。易房拼拼想做的很简单
              —— 用数据和专业，把这件事变得透明、简单、靠谱。
            </p>
            <p>
              我们扎根深圳，服务延伸至广州、香港、珠海、东莞等大湾区核心城市。为买家筛选真正低于市场价的笋盘，为有资金需求的客户对接落地的金融方案。我们宁可少做一单，也不做一单亏心生意
              —— 因为我们想做的，是你能托付一辈子置业大事的那个人。
            </p>
            <Link className="btn btn-primary" href="/m/demand" style={{ marginTop: 8 }}>
              认识我们的顾问团队
            </Link>
          </div>
          <div className="about-stats">
            <div className="stat">
              <b>2025</b>
              <div className="gold-rule" />
              <span>深耕大湾区，立足深圳</span>
            </div>
            <div className="stat">
              <b>9+</b>
              <div className="gold-rule" />
              <span>大湾区核心城市覆盖</span>
            </div>
            <div className="stat">
              <b>
                100<small style={{ fontSize: 20 }}>分</small>
              </b>
              <div className="gold-rule" />
              <span>笋度评分核验体系</span>
            </div>
            <div className="stat">
              <b>0</b>
              <div className="gold-rule" />
              <span>注水 / 虚假房源</span>
            </div>
          </div>
        </div>
      </section>

      {/* 企业文化 */}
      <section className="sec-pad culture" id="culture">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Our Values</span>
            <div className="gold-rule" />
            <h2>真房源 · 真笋盘 · 真服务</h2>
            <p>四条我们绝不让步的底线，也是「让买房更简单」的全部底气。</p>
          </div>
          <div className="values">
            <div className="val">
              <div className="vn">壹</div>
              <h4>真</h4>
              <p>每套房源都经笋度评分与实地核验，价格、折扣、产权一目了然，不夸大、不注水。</p>
            </div>
            <div className="val">
              <div className="vn">贰</div>
              <h4>透</h4>
              <p>从房价到贷款利率，所有数字摆在台面上。不藏猫腻，不玩信息差。</p>
            </div>
            <div className="val">
              <div className="vn">叁</div>
              <h4>专</h4>
              <p>深耕大湾区一手政策与银行资源，给得出真正能落地的置业与融资方案。</p>
            </div>
            <div className="val">
              <div className="vn">肆</div>
              <h4>诚</h4>
              <p>把客户的钱当自己的钱。宁可少做一单，不做一单亏心生意。</p>
            </div>
          </div>
        </div>
      </section>

      {/* 服务流程 */}
      <section className="sec-pad" style={{ background: "linear-gradient(180deg,var(--paper-warm),var(--yfp-ivory))" }}>
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">How It Works</span>
            <div className="gold-rule" />
            <h2>四步，找到你的笋盘</h2>
          </div>
          <div className="flow">
            <div className="step">
              <div className="sn">壹</div>
              <h4>说出需求</h4>
              <p>告诉我们预算、意向区域、户型与用途，3 分钟说清你想要什么。</p>
            </div>
            <div className="step">
              <div className="sn">贰</div>
              <h4>笋度匹配</h4>
              <p>系统按笋度在大湾区房源库筛出最匹配的房源，附折扣与核验状态。</p>
            </div>
            <div className="step">
              <div className="sn">叁</div>
              <h4>带看核验</h4>
              <p>顾问陪同实地带看，产权、价格、风险逐项核对，绝不踩坑。</p>
            </div>
            <div className="step">
              <div className="sn">肆</div>
              <h4>金融落地</h4>
              <p>需要贷款？同步对接按揭、房抵、赎楼方案，省心成交。</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="sec-pad" id="contact">
        <div className="wrap">
          <div className="cta">
            <div className="cta-in">
              <h2>在大湾区，找一套放心的笋盘</h2>
              <p>留下需求，专业顾问 1 对 1 为你匹配笋盘、规划贷款方案 —— 全程免费咨询。</p>
              <div className="hero-cta">
                <Link className="btn btn-gold" href="/m/demand">
                  免费登记需求
                </Link>
                <Link className="btn btn-ghost on-dark" href="/m">
                  先逛逛笋盘
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <div className="brand">
                <span className="brand-mark">
                  <img src="/assets/logo.png" alt="易房拼拼" width={44} height={44} />
                </span>
                <span className="brand-text">
                  <span className="brand-name" style={{ color: "#fff" }}>
                    易房<b style={{ color: "var(--yfp-gold)" }}>拼拼</b>
                  </span>
                  <span className="brand-tag" style={{ color: "rgba(255,255,255,.5)" }}>
                    让买房更简单
                  </span>
                </span>
              </div>
              <p>
                立足深圳，放眼大湾区。以笋度评分为核心的笋盘代理与房产金融服务，做让用户放心靠谱的笋盘代理人。
              </p>
            </div>
            <div className="foot-col">
              <h5>核心服务</h5>
              <a href="#match">笋盘智能匹配</a>
              <a href="#loan">房产金融贷款</a>
              <a href="#listings">笋盘精选</a>
              <a href="#match">笋度评分体系</a>
            </div>
            <div className="foot-col">
              <h5>关于</h5>
              <a href="#about">公司简介</a>
              <a href="#culture">企业文化</a>
              <a href="#contact">联系我们</a>
              <a href="#about">加入我们</a>
            </div>
            <div className="foot-col">
              <h5>联系 / 关注</h5>
              <a href="tel:400-000-0000">400-000-0000</a>
              <a href="#">深圳市 · 大湾区</a>
              <div className="qr" style={{ marginTop: 8 }}>
                微信二维码
                <br />
                待替换
              </div>
            </div>
          </div>
          <div className="copybar">
            <span>© 2025 易房拼拼 YiFangPinPin · 让买房更简单</span>
            <span>粤ICP备 XXXXXXXX 号（待备案）· 本站房源数据仅供展示</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
