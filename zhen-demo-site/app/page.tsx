export const metadata = {
  title: "甄不想加班 · C 端交互 Demo",
  description: "职场 Say No AI 参谋移动端产品交互演示",
};

export default function Home() {
  return (
    <main className="demo-page">
      <header className="demo-intro">
        <div>
          <p className="demo-kicker">C 端产品交互原型</p>
          <h1>甄不想加班</h1>
          <p className="demo-description">职场 Say No · 你的 AI 参谋。点击手机中的首页、参谋、关系和我的，体验完整流程。</p>
        </div>
        <div className="demo-status"><span />可交互 Demo</div>
      </header>
      <section className="demo-stage" aria-label="甄不想加班移动端交互演示">
        <iframe className="demo-frame" src="/demo.html" title="甄不想加班交互 Demo" allow="microphone; clipboard-write" />
      </section>
      <footer>产品讨论稿 · 2026</footer>
    </main>
  );
}
