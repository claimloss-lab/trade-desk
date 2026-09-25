import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
PVD_PAGE = PUBLIC / "pvd.html"
MAIN_PAGE = PUBLIC / "index.html"
PRIVATE_DATA = Path.home() / "AppData/Local/hermes/cache/pvd-private-data.json"


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

    def test_private_pvd_data_is_not_in_public_repository(self):
        main = MAIN_PAGE.read_text(encoding="utf-8")
        pvd_page = PVD_PAGE.read_text(encoding="utf-8")
        self.assertNotIn("728088.28", main)
        self.assertNotIn("728088.28", pvd_page)
        backup = main.split("function buildBackupData(){")[1].split("function exportBackup()")[0].replace(" ", "").replace("\\n", "")
        self.assertNotIn("privatePvd", backup)
        self.assertIn("totalNetWorth:fm(portfolios.reduce((s,p)=>s+portNet(p),0))", backup)
        self.assertTrue(PRIVATE_DATA.exists())
        data = json.loads(PRIVATE_DATA.read_text(encoding="utf-8"))
        self.assertEqual(round(sum(p["currentValueTHB"] for p in data["policies"]), 2), 728088.28)
        self.assertEqual(round(data["totalTHB"], 2), 728088.28)


if __name__ == "__main__":
    unittest.main()
