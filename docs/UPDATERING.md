# Uppdatera BrewHub från appen (Unraid)

Den här guiden beskriver hur du sätter upp och använder uppdateringsknappen under **Settings → Updates**. Den gäller bara själva appen (backend och webbgränssnitt). Firmware på ESP32-enheterna uppdateras som förut via OTA under **Settings → Firmware**.

> **Status:** koden är testad med enhetstester där Docker är mockat, och gränssnittet är testat lokalt. Hela flödet har **inte** körts mot en riktig Docker eller Unraid än. Gör därför torrkörningen i steg 8 innan du litar på knappen.

---

## Så fungerar det

```
Webbläsare ──► caddy ──► backend ──(hemlig nyckel)──► updater ──► docker-proxy ──► Docker
                                   internt nätverk               bara ett internt nätverk,
                                   utan port ut                  filtrerat API
```

- **Appen har aldrig tillgång till Docker.** Bara den lilla tjänsten `updater` har det, och den går via `docker-proxy` (tecnativa/docker-socket-proxy). Proxyn släpper bara igenom de API-anrop som `docker compose pull/stop/up/ps` behöver.
- `updater` och `docker-proxy` har **ingen port mot nätverket.** Backend når updatern på compose-nätverket och måste skicka `UPDATER_SECRET`. Proxyn ligger på ett eget internt nätverk utan internet, och där finns bara updatern.
- Bara en inloggad användare kan starta en uppdatering. BrewHub har ett enda admin-konto.
- Det går bara att installera **den version GitHub kallar senaste release.** Varken appen eller en angripare kan välja något annat image-namn eller någon annan tagg.

**Vad som händer när du trycker "Update":**

1. Den nya versionen hämtas med exakt tagg, till exempel `1.4.0` och aldrig `latest`. Om det misslyckas har ingenting ändrats.
2. Backend stoppas, så att databasen står still.
3. SQLite-databasen kopieras och kontrolleras: samma checksumma, giltig SQLite-header och `PRAGMA integrity_check = ok`. `.env` sparas också.
4. `BREWHUB_IMAGE_TAG` och `BREWHUB_FRONTEND_TAG` i `.env` sätts till den nya versionen.
5. `backend` och `caddy` skapas om. `mosquitto`, `updater` och proxyn rörs inte.
6. Hälsokontroll: backend måste svara `ok` **och rapportera den nya versionen**, och caddy måste vara igång. Den väntar som längst 3 minuter.
7. Om något går fel sker en **automatisk återställning**: de gamla taggarna skrivs tillbaka i `.env`, databasbackupen läggs tillbaka, den gamla versionen startas och hälsokontrolleras.
8. Status och logg sparas i `/state/status.json`. De senaste 5 backuperna sparas (`BREWHUB_KEEP_BACKUPS`).

Appen är nere i ungefär en minut. Enheterna fortsätter att reglera temperaturen med sina senaste inställningar under tiden.

---

## Engångsinställning

Exemplen utgår från att compose-filerna ligger i `/mnt/user/appdata/brewhub/docker`. Byt till din egen sökväg överallt. Alla kommandon körs i Unraids terminal (`>_` uppe till höger, eller SSH).

### 1. Få in koden på `main`

Uppdateringsfunktionen ligger på grenen `feat/self-update`. Den bygger vidare på `feat/profile-templates` och `ui/redesign`. Mergea dem till `main` som vanligt.

### 2. Gör den första releasen

En release skapas när du pushar en versionstagg. Det beskrivs i detalj under [Släppa en ny version](#släppa-en-ny-version).

```bash
git checkout main && git pull
git tag -a v1.0.0 -m "BrewHub 1.0.0"
git push origin v1.0.0
```

Gå till **GitHub → Actions → Release** och vänta tills alla steg är gröna. Då finns följande:
- `ghcr.io/ippodrome/brewhub-backend:1.0.0` (och `:latest`)
- `ghcr.io/ippodrome/brewhub-frontend:1.0.0`
- `ghcr.io/ippodrome/brewhub-updater:1.0.0`
- en release `v1.0.0` under **Releases**

### 3. Bestäm hur Unraid får hämta images (GHCR)

Repot är privat, och då blir images i GHCR också privata från början. Välj **ett** av två alternativ:

**Alternativ A, gör paketen publika (enklast):**
GitHub → din profil → **Packages** → `brewhub-backend` → **Package settings** → **Change visibility** → **Public**. Gör samma sak för `brewhub-frontend` och `brewhub-updater`.
Koden i repot är fortfarande privat, men vem som helst kan hämta de färdigbyggda imagesen och läsa den kompilerade koden i dem. Det finns inga hemligheter i imagesen. Lösenord och nycklar ligger bara i din `.env`.

**Alternativ B, behåll dem privata och logga in med en token:**
1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)** → **Generate new token (classic)**.
   - Note: `unraid-ghcr-pull`, Expiration: till exempel 1 år
   - Scope: **bara `read:packages`**
   (Fine-grained tokens fungerar i skrivande stund inte mot GHCR, därför används en classic token.)
2. Logga in på Unraid och spara inloggningen **på arrayen**. `/root` på Unraid töms vid omstart, så den kan inte ligga där:
   ```bash
   cd /mnt/user/appdata/brewhub/docker
   mkdir -p docker-auth
   docker --config ./docker-auth login ghcr.io -u <ditt-github-namn>
   # klistra in token som lösenord
   chmod 600 docker-auth/config.json
   ```
   Updatern läser `./docker-auth/config.json` (skrivskyddat). Om du själv vill köra `docker compose pull` för hand, skriv `DOCKER_CONFIG=./docker-auth docker compose pull`.

### 4. Token för att läsa releaser (bara om repot är privat)

Updatern frågar GitHub vilken som är senaste release. För ett privat repo krävs en token:

GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**
- Repository access: **Only select repositories** → `ippodrome/brewhub`
- Permissions: **Contents: Read-only**. Inget annat.

Spara token som `BREWHUB_GITHUB_TOKEN` i steg 6. Om repot är publikt behövs ingen token, men då gäller GitHubs gräns på 60 anrop per timme. Appen cachar svaret i 15 minuter.

### 5. Kör på images och lås versionen

`docker-compose.yml` hämtar redan färdiga images (`image: ghcr.io/...`). Kontrollera att din Unraid-stack **inte** startas med `docker-compose.dev.yml`, eftersom den bygger från källkod (`build:`). Om den gör det, ta bort den filen ur stacken.

Kopiera in de nya filerna från repot till compose-mappen:
```bash
cd /mnt/user/appdata/brewhub/docker
# från en checkout av main, eller ladda ner dem från GitHub:
#   docker/docker-compose.yml
#   docker/docker-compose.updater.yml
#   docker/docker-auth/README
```

### 6. Lägg till i `.env`

Ta först reda på vilket **projektnamn** stacken redan kör under:
```bash
docker compose ls
```
> ⚠️ Använd **exakt det namnet**. Med ett nytt namn skapar Docker nya, tomma volymer. Datan finns kvar, men appen ser tom ut.

Skapa en hemlig nyckel:
```bash
openssl rand -hex 32
```

Lägg sedan till följande i `.env` (exempel):
```ini
# Exakta versioner krävs. Updatern skriver om de två första raderna själv.
BREWHUB_IMAGE_TAG=1.0.0
BREWHUB_FRONTEND_TAG=1.0.0
BREWHUB_UPDATER_TAG=1.0.0

# Gör så att vanliga `docker compose`-kommandon tar med updatern
COMPOSE_FILE=docker-compose.yml:docker-compose.updater.yml
COMPOSE_PROJECT_NAME=brewhub                         # från `docker compose ls`
BREWHUB_COMPOSE_DIR=/mnt/user/appdata/brewhub/docker # absolut sökväg till den här mappen

UPDATER_SECRET=<utskriften från openssl ovan>
BREWHUB_GITHUB_TOKEN=<token från steg 4, eller tomt>
BREWHUB_KEEP_BACKUPS=5

# Börja med torrkörning (steg 8), sätt till 0 efteråt
UPDATER_DRY_RUN=1
```

Om du kör den medföljande Mosquitto-brokern ska den filen också med, både i `COMPOSE_FILE` och i `BREWHUB_COMPOSE_FILES`:
```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.mosquitto.yml:docker-compose.updater.yml
BREWHUB_COMPOSE_FILES=docker-compose.yml:docker-compose.mosquitto.yml:docker-compose.updater.yml
```

> **Compose Manager-pluginet på Unraid:** pluginet skickar egna `-f`-flaggor. Då gäller inte `COMPOSE_FILE`. Klistra i så fall in tjänsterna och nätverket från `docker-compose.updater.yml` i stackens compose-fil via **Edit Stack**. Sätt sedan `BREWHUB_COMPOSE_DIR` till stackens mapp och `BREWHUB_COMPOSE_FILES` till stackens filnamn. Torrkörningen i steg 8 visar om det stämmer.

Skydda filen:
```bash
chmod 600 .env
```

### 7. Starta

```bash
cd /mnt/user/appdata/brewhub/docker
docker compose pull          # med alternativ B: DOCKER_CONFIG=./docker-auth docker compose pull
docker compose up -d
docker compose ps            # backend, caddy, updater, docker-proxy ska vara "running"
docker compose logs updater  # ska visa "listening on :8080 (DRY RUN) for project brewhub"
```

Öppna appen → **Settings → Updates**. Där ska det stå *Installed 1.0.0* och *You're on the latest version*.

### 8. Torrkör (rekommenderas)

En torrkörning hämtar images och gör en kontrollerad backup, men stoppar och byter ingenting:
```bash
docker compose exec updater sh -c 'wget -qO- \
  --header "Authorization: Bearer $UPDATER_SECRET" \
  --header "Content-Type: application/json" \
  --post-data "{\"version\":\"1.0.0\",\"dryRun\":true}" \
  http://127.0.0.1:8080/update; sleep 20; wget -qO- \
  --header "Authorization: Bearer $UPDATER_SECRET" http://127.0.0.1:8080/status'
```
Resultatet ska vara `"state":"succeeded"` med `"dryRun":true`. Om det blir `failed`, läs `error` och `log` och titta under [Felsökning](#felsökning).

Sätt därefter `UPDATER_DRY_RUN=0` i `.env` och kör `docker compose up -d updater`.

---

## Släppa en ny version

1. Se till att allt du vill ha med är mergat till `main` och att CI är grönt.
2. Välj versionsnummer: `MAJOR.MINOR.PATCH`, till exempel `1.1.0` för nya funktioner och `1.0.1` för buggfixar.
3. Tagga och pusha:
   ```bash
   git checkout main && git pull
   git tag -a v1.1.0 -m "BrewHub 1.1.0"
   git push origin v1.1.0
   ```
4. **Actions → Release** gör följande:
   - kör alla tester (typecheck, build och test)
   - bygger och pushar backend-, frontend- och updater-images med versionen inbakad, som `:1.1.0` och `:latest`
   - skapar en GitHub-release med automatiska release notes

   Om ett test fäller körningen skapas varken images eller release.
5. Vill du kan du redigera texten i releasen på GitHub. Det är den texten som visas i appen under *What's new*.

> Pushar till `main` bygger fortfarande images med taggarna `edge` och `sha-xxxxxxx`, men aldrig `latest` eller ett versionsnummer. Det är bara releaser som syns i appen.

---

## Uppdatera från appen

1. En diskret rad visas överst i appen: *"BrewHub 1.1.0 is available · Review update"*. Du kan också gå direkt till **Settings → Updates** och trycka **Check now**.
2. Läs *What's new* och tryck **Update to 1.1.0**.
3. Bekräfta i dialogrutan, som påminner om backup, ungefär en minuts avbrott och automatisk återställning.
4. Följ stegen i kortet: *Download → Stop backend → Back up database → Switch version → Start new version → Health check*. Medan backend startar om står det *"BrewHub is restarting…"*. Det är normalt.
5. När det står **Updated to 1.1.0**, tryck **Reload now** så laddas det nya gränssnittet.

---

## Om något går fel

Kortet visar alltid hur det gick, och **Show log** visar varje steg.

| Resultat | Vad det betyder | Behöver du göra något? |
|---|---|---|
| **Update … did not start. Nothing was changed.** | Hämtningen misslyckades, till exempel på grund av nätverk, token eller en tagg som saknas. Ingenting var stoppat. | Åtgärda orsaken och försök igen. |
| **Update stopped before switching — 1.0.0 is running again.** | Backupen misslyckades, så uppdateringen avbröts innan något byttes. | Läs orsaken, till exempel om disken är full. |
| **Update to 1.1.0 failed — rolled back to 1.0.0.** | Den nya versionen startade inte eller var inte frisk. Gamla taggar och databasen från före uppdateringen är tillbaka och fungerar. | Nej, men rapportera felet och släpp en fix som en ny version. |
| **Update and automatic rollback both failed.** | Varken den nya eller den gamla versionen kom upp, eller så startades updatern om mitt i. | **Ja**, följ den manuella återställningen nedan. |

> Observera: data som skrevs **mellan backupen och återställningen** försvinner, ungefär 1–3 minuter. Backend är stoppad under den tiden, så det är i praktiken bara telemetri som inte kunde tas emot ändå.

### Manuell återställning

Ersätt `brewhub` med ditt projektnamn och `1.0.0` med versionen du vill tillbaka till.

```bash
cd /mnt/user/appdata/brewhub/docker

# 1. Se status och vilken backup som gjordes
docker compose exec updater cat /state/status.json | head -40
docker run --rm -v brewhub_updater-state:/state alpine ls -1 /state/backups

# 2. Stoppa backend
docker compose stop backend

# 3. Lägg tillbaka databasen (byt <backup-mapp> mot rätt mapp från listan)
docker run --rm \
  -v brewhub_backend-data:/data \
  -v brewhub_updater-state:/state \
  alpine sh -c 'rm -f /data/brewhub.db-wal /data/brewhub.db-shm && cp -a /state/backups/<backup-mapp>/brewhub.db* /data/'

# 4. Peka .env på den gamla versionen (backupens env.before visar hur den såg ut)
docker run --rm -v brewhub_updater-state:/state alpine cat /state/backups/<backup-mapp>/env.before | grep TAG
sed -i 's/^BREWHUB_IMAGE_TAG=.*/BREWHUB_IMAGE_TAG=1.0.0/; s/^BREWHUB_FRONTEND_TAG=.*/BREWHUB_FRONTEND_TAG=1.0.0/' .env

# 5. Starta och kontrollera
docker compose up -d backend caddy
docker compose ps
docker compose logs --tail=50 backend
```

Om du bara vill byta version utan att röra databasen räcker steg 4 och 5.

---

## Felsökning

| Symptom | Trolig orsak och åtgärd |
|---|---|
| *"In-app updates are not set up on this server"* | `UPDATER_URL` och `UPDATER_SECRET` når inte backend. Kontrollera att `docker-compose.updater.yml` är med, via `COMPOSE_FILE` eller stacken, och kör `docker compose up -d`. |
| *"The updater service did not answer."* | `docker compose ps updater` och `docker compose logs updater`. Saknas en variabel stoppar compose med ett tydligt `set … in .env`. |
| *"UPDATER_SECRET does not match the updater."* | Backend och updater har startats med olika nycklar. Kör `docker compose up -d backend updater`. |
| *"No release found … (a private repo needs GITHUB_TOKEN)"* | Sätt `BREWHUB_GITHUB_TOKEN` (steg 4) och kör `docker compose up -d updater`. |
| *"GitHub API returned 401/403"* | Token har gått ut eller saknar Contents: Read. Skapa en ny. 403 utan token betyder att gränsen på 60 anrop per timme är nådd, så vänta en stund. |
| *"… must be pinned to a version like 1.2.3"* | `BREWHUB_IMAGE_TAG` eller `BREWHUB_FRONTEND_TAG` är `latest` eller saknas. Sätt dem till versionen som körs nu. |
| Hämtningen misslyckas med `denied` / `unauthorized` | Privata paket: kontrollera `docker-auth/config.json` (steg 3B) eller om token har gått ut. |
| Hämtningen misslyckas med `manifest unknown` | Release-workflowen pushade inte imagen. Kontrollera **Actions → Release**. |
| `403 Forbidden` från docker-proxy i loggen | Compose behövde ett API-anrop som proxyn spärrar. Kontrollera att proxyns miljövariabler matchar `docker-compose.updater.yml`. Öppna inte mer än nödvändigt. |
| Appen ser tom ut efter setup | Fel `COMPOSE_PROJECT_NAME`, så nya tomma volymer skapades. Sätt rätt namn från `docker compose ls` och kör `docker compose up -d`. Den gamla datan finns kvar. |
| Hälsokontrollen tar slut trots att appen fungerar | Backend rapporterar inte den nya versionen, till exempel för att imagen byggdes utan release-workflowen. Kontrollera `curl -s http://<backend>/api/health` inifrån nätverket eller titta i loggen. |
| Disken är full under backup | Sänk `BREWHUB_KEEP_BACKUPS` eller rensa i `brewhub_updater-state`. |

### Uppdatera updatern själv

Updatern kan av säkerhetsskäl inte uppdatera sig själv. Det behövs sällan, men så här gör du:
```bash
sed -i 's/^BREWHUB_UPDATER_TAG=.*/BREWHUB_UPDATER_TAG=1.1.0/' .env
docker compose pull updater && docker compose up -d updater
```

---

## Kvarvarande risker (ärligt)

- **Proxyn är fortfarande kraftfull.** För att `docker compose up` ska fungera måste proxyn tillåta att containrar skapas. Den som tar över updatern kan alltså i teorin starta en privilegierad container, och då har den full kontroll över Unraid. Det skyddas av att updatern inte har någon port ut, att proxyn ligger på ett eget internt nätverk, att updatern kräver en lång hemlig nyckel och att den bara kan installera den officiella senaste releasen. Risken blir mindre, men den försvinner inte.
- **Ett kapat GitHub-konto eller CI-flöde** kan släppa en skadlig "release" som du sedan installerar med ett klick. Images signeras inte än (till exempel med cosign). Skydda GitHub-kontot med tvåstegsverifiering.
- **Hemligheter ligger i klartext** i `.env` och i `docker-auth/config.json` på Unraid. `chmod 600` hjälper mot andra användare men inte mot någon som redan är root.
- **Databasmigreringar går bara framåt.** Återställningen fungerar genom att lägga tillbaka backupen, och data från de minuter uppdateringen pågår kan gå förlorad.
- **Om strömmen går eller Unraid startar om mitt i** kan stacken stå halvvägs. Status visar det som *rollback_failed*. Följ den manuella återställningen.
- **Updatern kör som root i containern**, eftersom databasvolymen och `.env` ägs av root. Den har dock bara rättigheterna CHOWN, DAC_OVERRIDE och FOWNER, ett skrivskyddat filsystem och `no-new-privileges`.
- **Inte provkört mot riktig Docker.** Logiken är testad med mockar (23 tester för updatern och 9 för backend-routes), men compose-filerna och proxyns regler har inte körts på Unraid. Torrkörningen i steg 8 är det första riktiga testet.
