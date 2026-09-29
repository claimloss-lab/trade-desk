import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PVD_PAGE = PUBLIC / "pvd.html"
MAIN_PAGE = PUBLIC / "index.html"
PORTFOLIO_SEED = PUBLIC / "portfolio-data.json"


class PvdPrivacyIntegrationTests(unittest.TestCase):
    def test_pvd_page_loads_user_data_only_from_browser_local_storage(self):
        page = PVD_PAGE.read_text(encoding="utf-8")
        self.assertIn("td_private_pvd_v1", page)
        self.assertIn("FileReader", page)
        self.assertIn("localStorage.setItem", page)

    def test_dashboard_adds_private_pvd_value_and_links_page(self):
        page = MAIN_PAGE.read_text(encoding="utf-8")
        self.assertIn('href="pvd.html"', page)
        self.assertIn("function privatePvdValue()", page)
        self.assertIn("+privatePvdValue()", page.replace(" ", ""))
        self.assertIn("localStorage.getItem('td_private_pvd_v1')", page)

    def test_public_backup_does_not_contain_pvd_records(self):
        page = MAIN_PAGE.read_text(encoding="utf-8")
        backup = page.split("function buildBackupData(){")[1].split("function exportBackup()")[0]
        backup_compact = backup.replace(" ", "").replace("\\n", "")
        self.assertNotIn("privatePvd", backup_compact)
        self.assertIn("totalNetWorth:fm(portfolios.reduce((s,p)=>s+portNet(p),0))", backup_compact)

        data = json.loads(PORTFOLIO_SEED.read_text(encoding="utf-8"))
        public_payload = json.dumps(data, ensure_ascii=False).lower()
        self.assertNotIn("pvd", public_payload)


if __name__ == "__main__":
    unittest.main()
