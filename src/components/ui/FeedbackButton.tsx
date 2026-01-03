"use client";

export default function FeedbackButton() {
  const handleClick = () => {
    window.location.href =
      "https://semperadmin.github.io/Sentinel/#detail/dutysync/todo";
  };

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-8 right-8 bg-primary text-white border-none py-3 px-5 rounded-full text-base font-semibold cursor-pointer shadow-lg transition-all duration-300 z-[1000] flex items-center gap-2 hover:bg-primary-light hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
      title="Share Feedback"
      style={{
        boxShadow: "0 4px 12px rgba(191, 0, 15, 0.3)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 6px 16px rgba(191, 0, 15, 0.4)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(191, 0, 15, 0.3)";
      }}
    >
      <span role="img" aria-label="feedback">
        💬
      </span>{" "}
      Feedback
    </button>
  );
}
