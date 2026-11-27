# Durango: Reborn — Fan Project Disclaimer

> **English** · [ภาษาไทย](#ภาษาไทย) · [한국어](#한국어)

## English

**Durango: Reborn is an unofficial, non-commercial fan project.**

- This project is **not affiliated with, endorsed by, or sponsored by** NEXON Korea Corporation, NEXON Games, or any of their subsidiaries.
- *Durango: Wild Lands* (야생의 땅: 듀랑고), its name, logos, characters, artwork, music, and all related content are the **property of NEXON** and their respective owners.
- This project is made **by fans, for fans**, to preserve the memory of a game whose official service ended in December 2019.
- **We do not make any profit.** There are no sales, in-game purchases, VIP, paid items, advertising, or donations. If anyone asks you for money in the name of Durango: Reborn, it is **not us**.
- Please do not sell, rent, or redistribute this project for profit.
- If you are a rights holder and have any concern, please contact us at **[supercodeth@gmail.com]**. We will respond promptly and will **comply with any request, including taking this project down**.

## ภาษาไทย

**Durango: Reborn เป็นโปรเจกต์ของแฟนเกม ไม่ใช่ของทางการ และไม่แสวงหาผลกำไรใดๆ ทั้งสิ้น**

- โปรเจกต์นี้**ไม่มีส่วนเกี่ยวข้อง ไม่ได้รับการรับรอง และไม่ได้รับการสนับสนุน**จาก NEXON Korea Corporation, NEXON Games หรือบริษัทในเครือ
- *Durango: Wild Lands* (야생의 땅: 듀랑고) รวมถึงชื่อ โลโก้ ตัวละคร ภาพ เพลง และเนื้อหาทั้งหมดที่เกี่ยวข้อง เป็น**ทรัพย์สินของ NEXON** และเจ้าของสิทธิ์ที่เกี่ยวข้อง
- โปรเจกต์นี้จัดทำขึ้น**โดยแฟนเกม เพื่อแฟนเกม** เพื่อเก็บรักษาความทรงจำของเกมที่ปิดให้บริการไปเมื่อเดือนธันวาคม 2019
- **เราไม่มีรายได้ใดๆ ทั้งสิ้น** ไม่มีการขาย ไม่มีระบบเติมเงิน ไม่มี VIP ไม่มีไอเทมขาย ไม่มีโฆษณา และไม่รับโดเนท หากมีใครเรียกเก็บเงินในนาม Durango: Reborn **นั่นไม่ใช่เรา**
- ห้ามนำโปรเจกต์นี้ไปขาย ให้เช่า หรือเผยแพร่ต่อเพื่อหาผลประโยชน์
- หากท่านเป็นเจ้าของสิทธิ์และมีข้อกังวลใดๆ กรุณาติดต่อ **[supercodeth@gmail.com]** เราจะตอบกลับโดยเร็ว และ**พร้อมปฏิบัติตามทุกคำขอ รวมถึงการปิดโปรเจกต์นี้**

## 한국어

**Durango: Reborn은 비공식, 비영리 팬 프로젝트입니다.**

- 본 프로젝트는 NEXON Korea Corporation, NEXON Games 및 그 계열사와 **관련이 없으며, 승인이나 후원을 받지 않았습니다.**
- *야생의 땅: 듀랑고 (Durango: Wild Lands)*의 명칭, 로고, 캐릭터, 아트워크, 음악 등 모든 관련 콘텐츠의 권리는 **NEXON** 및 각 권리자에게 있습니다.
- 본 프로젝트는 2019년 12월 서비스가 종료된 게임을 추억하기 위해 **팬이 팬을 위해** 만든 것입니다.
- **어떠한 수익도 얻지 않습니다.** 판매, 인게임 결제, VIP, 유료 아이템, 광고, 후원을 일절 받지 않습니다. Durango: Reborn의 이름으로 돈을 요구하는 경우 **저희가 아닙니다.**
- 본 프로젝트를 판매, 대여 또는 영리 목적으로 재배포하지 마십시오.
- 권리자께서 우려 사항이 있으시면 **[supercodeth@gmail.com]** 로 연락해 주십시오. 신속히 답변드리며, **프로젝트 중단을 포함한 모든 요청에 따르겠습니다.**

## Server list

- `servers-v3.json` is the one source of the game's server list (servers, lanes, gateways, links).
- `servers-v2.json` and `servers.json` are generated from it for older clients. Do not edit them by hand.
- The tools need Python 3.10 or newer (standard library only).
- After changing `servers-v3.json`, run `python tools/gen_server_lists.py` to rewrite both files.
- Before every commit, run `python tools/gen_server_lists.py --check` (exit 0 = in sync; exit 1 names the file that differs or the catalog error).
- To have git run that check on every commit, run once per clone: `git config core.hooksPath tools/hooks`.
- Tests: `python -m unittest tools/test_gen_server_lists.py -v`.
- A push to `main` reaches players at once: clients and launchers read these files from `main`.

## Portal (solocode.co)

- `portal/` is the source of the solocode.co front page: a server picker with no build step and no npm.
- It reads `servers-v3.json` from raw GitHub (`main`). If that fails it falls back to the copy deployed next to the page.
- `portal/catalog.js` holds all the page logic and never touches the DOM. `portal/app.js` draws the page with `textContent` only.
- Tests (Node 20 or newer): `node --test "portal/test/*.test.js"`.
- Local preview: serve the repo root (`python -m http.server 8466 --bind 127.0.0.1`), then open `http://127.0.0.1:8466/portal/?catalog=/servers-v3.json`. `?catalog=` only works on localhost.
- Deploying to 76.13 happens only on the owner's order. Do not touch the nginx config:

```bash
# stage: portal/ without test/, plus the root servers-v3.json as the same-origin fallback
rm -rf /tmp/portal-stage && mkdir /tmp/portal-stage && cp -r portal/. /tmp/portal-stage/ && rm -rf /tmp/portal-stage/test && cp servers-v3.json /tmp/portal-stage/
ssh root@classic.solocode.co 'cp -a /var/www/solocode-portal /var/www/solocode-portal.bak-$(date +%Y%m%d-%H%M)'
scp -r /tmp/portal-stage/. root@classic.solocode.co:/var/www/solocode-portal/
# rollback: ssh root@classic.solocode.co 'rsync -a --delete /var/www/solocode-portal.bak-<stamp>/ /var/www/solocode-portal/'
```
