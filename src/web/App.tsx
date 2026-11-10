import { useCallback, useEffect, useState } from "react";
import { createApi, isApiError } from "./api.js";
import { type ConfirmPrompt, confirmAndRun, uninstallPrompt } from "./confirm.js";
import { useConfirmDialog, useRoute } from "./hooks.js";
import type {
  CatalogItem,
  DoctorReport,
  HarnessInfo,
  InspectRequest,
  InspectResult,
  InstallationView,
  SkillDetail,
  SkillSummary,
  TargetResult,
} from "./types.js";
import { ConfirmDialog, ErrorBanner, Skeleton } from "./ui.js";
import { CatalogView } from "./views/catalog.js";
import { SkillDetailView } from "./views/detail.js";
import { DoctorView } from "./views/doctor.js";
import { HarnessesView } from "./views/harnesses.js";
import { ImportView } from "./views/import.js";
import { MatrixView } from "./views/matrix.js";
import { SkillsView } from "./views/skills.js";

const api = createApi();

interface ErrorInfo {
  readonly message: string;
  readonly code?: string;
}

function errorInfo(error: unknown): ErrorInfo {
  if (isApiError(error)) {
    if (error.code === "unauthorized") {
      return {
        message:
          "Sesi tidak valid. Buka lagi URL ber-token yang dicetak server di terminal, lalu muat ulang halaman ini.",
        code: error.code,
      };
    }
    return { message: error.message, code: error.code };
  }
  return { message: error instanceof Error ? error.message : "Galat tidak dikenal." };
}

function describeResults(results: readonly TargetResult[], verb: string): string {
  if (results.length === 0) {
    return `Perintah ${verb} selesai tanpa hasil per Target.`;
  }
  return results
    .map((result) =>
      result.ok
        ? `${verb} ${result.targetId}: berhasil`
        : `${verb} ${result.targetId}: ${result.error?.message ?? "ditolak"}`,
    )
    .join(" · ");
}

const NAV: readonly {
  readonly href: string;
  readonly label: string;
  readonly view: string;
  readonly group: string;
}[] = [
  { href: "#/skills", label: "Skills", view: "skills", group: "Library" },
  { href: "#/import", label: "Impor", view: "import", group: "Library" },
  { href: "#/catalog", label: "Katalog", view: "catalog", group: "Library" },
  { href: "#/matrix", label: "Matrix", view: "matrix", group: "Pemasangan" },
  { href: "#/harnesses", label: "Harnesses", view: "harnesses", group: "Pemasangan" },
  { href: "#/doctor", label: "Doctor", view: "doctor", group: "Perawatan" },
];

const NAV_GROUPS: readonly string[] = ["Library", "Pemasangan", "Perawatan"];

export function App() {
  const route = useRoute();
  const confirm = useConfirmDialog();

  const [skills, setSkills] = useState<readonly SkillSummary[]>([]);
  const [installations, setInstallations] = useState<readonly InstallationView[]>([]);
  const [harnesses, setHarnesses] = useState<readonly HarnessInfo[]>([]);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [staged, setStaged] = useState<InspectResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [detailName, setDetailName] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [catalog, setCatalog] = useState<readonly CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSkills, nextInstallations, nextHarnesses] = await Promise.all([
        api.skills(),
        api.installations(),
        api.harnesses(),
      ]);
      setSkills(nextSkills);
      setInstallations(nextInstallations);
      setHarnesses(nextHarnesses);
      setError(null);
    } catch (caught) {
      setError(errorInfo(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadDoctor = useCallback(async () => {
    setDoctorLoading(true);
    try {
      setDoctor(await api.doctor());
      setError(null);
    } catch (caught) {
      setError(errorInfo(caught));
    } finally {
      setDoctorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.view === "doctor") {
      void loadDoctor();
    }
  }, [route.view, loadDoctor]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalog(await api.catalog());
    } catch (caught) {
      setCatalogError(errorInfo(caught).message);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.view === "catalog" && catalog.length === 0) {
      void loadCatalog();
    }
  }, [route.view, catalog.length, loadCatalog]);

  /**
   * Unduh sumber ke staging lalu tampilkan pratinjaunya (spec §13). Belum ada
   * yang masuk Library pada langkah ini, jadi membatalkan tidak meninggalkan
   * sampah apa pun.
   */
  const inspectSource = useCallback(async (input: InspectRequest) => {
    setBusy("inspect");
    setImportError(null);
    setStaged(null);
    try {
      setStaged(await api.inspect(input));
    } catch (caught) {
      setImportError(errorInfo(caught).message);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Impor dari staging setelah user melihat isinya; staging selalu dibuang server. */
  const importStaged = useCallback(async () => {
    if (staged?.stagingId === undefined) {
      return;
    }
    setBusy("import");
    setImportError(null);
    try {
      const skill = await api.importSkill({ stagingId: staged.stagingId });
      setStaged(null);
      setNotice(`${skill.name} diimpor ke Library. Pasang ke harness lewat layar Matrix.`);
      await reload();
    } catch (caught) {
      setImportError(errorInfo(caught).message);
    } finally {
      setBusy(null);
    }
  }, [staged, reload]);

  /** AC-9: perintah dependensi hanya berjalan setelah konfirmasi yang menyebutnya. */
  const runDeps = useCallback(async () => {
    if (detail === null) {
      return;
    }
    const commands = detail.dependencies ?? [];
    const listed = commands
      .map((command) => `${command.command} ${(command.args ?? []).join(" ")}`.trim())
      .join("\n");
    const approved = await confirm.ask({
      kind: "destructive",
      title: "Jalankan dependensi",
      message: "Perintah berikut akan dijalankan persis apa adanya untuk " + detail.name + ".",
      details: listed.length === 0 ? ["(tidak ada perintah)"] : listed.split("\n"),
      confirmLabel: "Jalankan",
    });
    if (!approved) {
      return;
    }
    setNotice(null);
    try {
      await api.depsRun({ skill: detail.name });
      setNotice(`Dependensi ${detail.name} selesai dijalankan.`);
    } catch (caught) {
      setNotice(null);
      setError(errorInfo(caught));
    }
  }, [detail, confirm]);

  /**
   * AC-8: menimpa isi Store dengan isi Library. Konfirmasi menyebut Target dan
   * akibatnya, dan server tetap menolak bila `confirm` tidak ikut terkirim.
   */
  const syncTarget = useCallback(
    async (targetId: string) => {
      if (detail === null) {
        return;
      }
      const approved = await confirm.ask({
        kind: "destructive",
        title: "Kembalikan dari Library",
        message:
          "Isi direktori " +
          targetId +
          " akan ditimpa dengan isi Library. Perubahan yang kamu buat di Store akan hilang; Library tidak berubah.",
        details: [detail.name, targetId, "sumber kebenaran: Library"],
        confirmLabel: "Timpa",
      });
      if (!approved) {
        return;
      }
      setBusy(`sync::${targetId}`);
      setNotice(null);
      try {
        await api.sync({ skill: detail.name, action: "restore", confirm: true });
        setNotice(`${detail.name} dikembalikan dari Library di ${targetId}.`);
        await reload();
      } catch (caught) {
        setError(errorInfo(caught));
      } finally {
        setBusy(null);
      }
    },
    [detail, confirm, reload],
  );

  /** Pasang skill katalog: unduh -> impor (bila perlu) -> pasang ke target pilihan. */
  const installFromCatalog = useCallback(
    async (item: CatalogItem, targetId: string) => {
      if (targetId === "") {
        setNotice("Pilih harness dulu sebelum memasang.");
        return;
      }
      setBusy(`catalog::${item.id}`);
      setNotice(null);
      try {
        const name = item.name;
        const sudahDiimpor = skills.some((skill) => skill.name === name);

        if (!sudahDiimpor) {
          const inspected = await api.inspect({
            type: "git",
            url: `https://github.com/${item.owner}/${item.repo}.git`,
            subdir: item.subdir,
          });
          if (inspected.stagingId === undefined) {
            throw new Error("Server tidak mengembalikan stagingId untuk pratinjau katalog.");
          }

          const files = inspected.files ?? [];
          const approved = await confirm.ask({
            kind: "destructive",
            title: `Impor ${name}?`,
            message:
              "Skill berikut akan diunduh dari GitHub dan diimpor ke Library, lalu dipasang ke target pilihan.",
            details: [
              `Repo: ${item.owner}/${item.repo}`,
              `Target: ${targetId}`,
              `${files.length} berkas`,
              ...(inspected.license === undefined ? [] : [`Lisensi: ${inspected.license}`]),
              ...(inspected.risky?.messages ?? []),
            ],
            confirmLabel: "Impor lalu pasang",
          });
          if (!approved) {
            setNotice(`Dibatalkan: ${name} tidak diimpor.`);
            return;
          }
          await api.importSkill({ stagingId: inspected.stagingId });
        }

        const results = await confirmAndRun(
          "install",
          (options) =>
            api.install({
              skill: name,
              targets: [targetId],
              acknowledgeShared: options.acknowledgeShared,
            }),
          confirm.ask,
          name,
        );

        if (results === null) {
          setNotice(`Dibatalkan: ${name} tidak dipasang ke ${targetId}.`);
          return;
        }
        setNotice(describeResults(results, "pasang"));
        await reload();
      } catch (caught) {
        setError(errorInfo(caught));
      } finally {
        setBusy(null);
      }
    },
    [skills, confirm, reload],
  );

  useEffect(() => {
    if (route.view !== "detail") {
      return;
    }
    const name = route.skill;
    setDetailName(name);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    let active = true;
    api
      .skill(name)
      .then((loaded) => {
        if (active) {
          setDetail(loaded);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setDetailError(errorInfo(caught).message);
        }
      })
      .finally(() => {
        if (active) {
          setDetailLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [route]);

  /** Pasang/cabut satu sel; 409 shared dan 409 drift lewat dialog konfirmasi (AC-6). */
  const toggle = useCallback(
    async (skillName: string, targetId: string, installed: boolean) => {
      setBusy(`${skillName}::${targetId}`);
      setNotice(null);
      try {
        if (installed) {
          // AC-6: mencabut selalu minta konfirmasi yang menyebut dampaknya,
          // bukan hanya ketika server membalas 409.
          const existing = installations.find(
            (item) => item.targetId === targetId && item.skillName === skillName,
          );
          const approved = await confirm.ask(
            uninstallPrompt(skillName, targetId, existing?.storeId),
          );
          if (!approved) {
            setNotice(`Dibatalkan: ${skillName} tetap terpasang di ${targetId}.`);
            return;
          }
        }

        const results = installed
          ? await confirmAndRun(
              "uninstall",
              (options) =>
                api.uninstall({
                  skill: skillName,
                  targets: [targetId],
                  acknowledgeShared: options.acknowledgeShared,
                  force: options.force,
                }),
              confirm.ask,
              skillName,
            )
          : await confirmAndRun(
              "install",
              (options) =>
                api.install({
                  skill: skillName,
                  targets: [targetId],
                  acknowledgeShared: options.acknowledgeShared,
                }),
              confirm.ask,
              skillName,
            );

        if (results === null) {
          setNotice(`Dibatalkan: tidak ada perubahan untuk ${skillName} di ${targetId}.`);
          return;
        }
        setNotice(describeResults(results, installed ? "cabut" : "pasang"));
        await reload();
        if (doctor !== null) {
          await loadDoctor();
        }
      } catch (caught) {
        setError(errorInfo(caught));
      } finally {
        setBusy(null);
      }
    },
    [confirm, installations, doctor, loadDoctor, reload],
  );

  const recheck = useCallback(async () => {
    setBusy("recheck");
    try {
      setHarnesses(await api.recheckHarnesses());
      setNotice("Deteksi ulang selesai.");
      setError(null);
    } catch (caught) {
      setError(errorInfo(caught));
    } finally {
      setBusy(null);
    }
  }, []);

  /** Hanya membuka URL resmi; tidak ada installer yang dijalankan (AC-11). */
  const connect = useCallback(async (harnessId: string) => {
    try {
      const url = await api.connect(harnessId);
      if (url === "") {
        setNotice("Server tidak memberi URL untuk harness ini.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      setNotice("URL resmi dibuka di tab baru. Aplikasi tidak menjalankan installer.");
    } catch (caught) {
      setError(errorInfo(caught));
    }
  }, []);

  const cleanTemp = useCallback(async () => {
    const tempDirs = doctor?.tempDirs ?? [];
    if (tempDirs.length === 0) {
      return;
    }
    const prompt: ConfirmPrompt = {
      kind: "destructive",
      title: "Hapus direktori sementara",
      message:
        "Folder sementara ini sisa operasi yang gagal dan aman dihapus. Isinya TIDAK dipulihkan, " +
        "tetapi tidak memengaruhi skill yang sudah terpasang maupun Library.",
      details: [...tempDirs],
      confirmLabel: `Ya, hapus ${tempDirs.length} direktori`,
    };
    if (!(await confirm.ask(prompt))) {
      setNotice("Dibatalkan: direktori sementara tidak dihapus.");
      return;
    }
    setBusy("clean-temp");
    try {
      const removed = await api.cleanTemp();
      setNotice(`${removed.length} direktori sementara dihapus.`);
      await loadDoctor();
    } catch (caught) {
      setError(errorInfo(caught));
    } finally {
      setBusy(null);
    }
  }, [confirm, doctor, loadDoctor]);

  const activeView = route.view === "detail" ? "skills" : route.view;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-slate-800 bg-slate-900/40 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="px-4 py-4 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-400">
            Skill Manager
          </p>
          <p className="mt-1 text-xs text-slate-500">Lokal — hanya 127.0.0.1, sesi cookie wajib</p>
        </div>
        <nav aria-label="Navigasi utama" className="px-3 pb-2 lg:px-4">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible">
            {NAV_GROUPS.map((group) => (
              <li key={group} className="flex-shrink-0">
                <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 lg:block">
                  {group}
                </p>
                <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
                  {NAV.filter((item) => item.group === group).map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={activeView === item.view ? "page" : undefined}
                        className={`flex items-center whitespace-nowrap border-l-2 px-3 py-2 text-sm transition-colors ${
                          activeView === item.view
                            ? "border-teal-400 bg-teal-500/10 text-teal-200"
                            : "border-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto border-t border-slate-800 px-4 py-4 lg:px-6">
          <button
            type="button"
            onClick={() => {
              void reload();
            }}
            className="w-full rounded border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Muat ulang data
          </button>
        </div>
      </aside>

      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        {error !== null && (
          <ErrorBanner
            title="Ada yang gagal"
            message={error.message}
            code={error.code}
            onRetry={() => {
              void reload();
            }}
          />
        )}

        {notice !== null && (
          <p role="status" className="rounded border border-slate-700 bg-slate-900/60 p-3 text-sm">
            {notice}
          </p>
        )}

        {loading ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">Memuat Library, installation, dan harness…</span>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <main>
            {route.view === "skills" && (
              <SkillsView
                skills={skills}
                installations={installations}
                harnesses={harnesses}
                onOpen={(name) => {
                  window.location.hash = `#/skills/${encodeURIComponent(name)}`;
                }}
              />
            )}
            {route.view === "import" && (
              <ImportView
                staged={staged}
                busy={busy === "inspect"}
                error={importError}
                onInspect={(input) => {
                  void inspectSource(input);
                }}
                onImport={() => {
                  void importStaged();
                }}
                onReset={() => {
                  setStaged(null);
                  setImportError(null);
                }}
              />
            )}
            {route.view === "catalog" && (
              <CatalogView
                items={catalog}
                harnesses={harnesses}
                loading={catalogLoading}
                error={catalogError}
                busyKey={busy}
                onInstall={(item, targetId) => {
                  void installFromCatalog(item, targetId);
                }}
              />
            )}
            {route.view === "matrix" && (
              <MatrixView
                skills={skills}
                installations={installations}
                harnesses={harnesses}
                busyKey={busy}
                onToggle={(skillName, targetId, installed) => {
                  void toggle(skillName, targetId, installed);
                }}
              />
            )}
            {route.view === "harnesses" && (
              <HarnessesView
                harnesses={harnesses}
                busy={busy === "recheck"}
                onRecheck={() => {
                  void recheck();
                }}
                onConnect={(harnessId) => {
                  void connect(harnessId);
                }}
              />
            )}
            {route.view === "doctor" && (
              <DoctorView
                report={doctor ?? { missing: [], unmanaged: [], stale: [], tempDirs: [] }}
                busy={doctorLoading || busy === "clean-temp"}
                onRefresh={() => {
                  void loadDoctor();
                }}
                onCleanTemp={() => {
                  void cleanTemp();
                }}
              />
            )}
            {route.view === "detail" && (
              <SkillDetailView
                skill={detail}
                name={detailName}
                installations={installations}
                loading={detailLoading}
                error={detailError}
                onBack={() => {
                  window.location.hash = "#/skills";
                }}
                onRunDeps={() => {
                  void runDeps();
                }}
                onSync={(targetId) => {
                  void syncTarget(targetId);
                }}
                busyTarget={busy?.startsWith("sync::") === true ? busy.slice(6) : null}
              />
            )}
          </main>
        )}

        {confirm.prompt !== null && (
          <ConfirmDialog
            prompt={confirm.prompt}
            onConfirm={() => {
              confirm.answer(true);
            }}
            onCancel={() => {
              confirm.answer(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
