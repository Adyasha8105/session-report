class SessionReport < Formula
  desc "Export AI coding assistant sessions (Claude Code, Codex, Cursor) to PDF or DOCX"
  homepage "https://github.com/Adyasha8105/session-report"
  url "https://github.com/Adyasha8105/session-report/archive/refs/tags/v1.0.0.tar.gz"
  sha256 "a5a3efe70b4fbadb0484b208d79ede72a41b03c945bac4d02649f06adc7ab54f"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "--ignore-scripts", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def post_install
    ohai "For PDF export, install Playwright's Chromium browser:"
    ohai "  npx playwright install chromium"
    ohai "DOCX export works immediately without any extra setup."
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/session-report --version")
  end
end
