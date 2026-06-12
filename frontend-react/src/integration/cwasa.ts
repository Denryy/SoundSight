// Обёртка над глобальным движком жестового аватара CWASA (ТЗ §6.6).
//
// CWASA грузится из …/vhg2026/cwa/allcsa.js (см. index.html) и кладёт глобал `CWASA`.
// Контейнер аватара — <div class="CWASAAvatar av0"> (рендерится в AvatarPanel).
// Здесь — инициализация, хуки готовности/простоя и ОБЯЗАТЕЛЬНАЯ очередь жестов:
// жесты играются строго последовательно, по хуку `animidle`. Очередь ограничена.

interface CwasaGlobal {
  init: (cfg?: Record<string, unknown>) => void;
  addHook: (name: string, fn: () => void) => void;
  playSiGMLText: (sigml: string, avIndex?: number) => void;
  previewSign?: (word: string) => void;
  spell?: (text: string) => void;
}

declare global {
  interface Window {
    CWASA?: CwasaGlobal;
  }
}

const MAX_QUEUE = 8; // ТЗ §6.6: ограничить очередь, чтобы не копилось отставание
// (поднято с 5 → 8: при длинной речи реже отбрасываются целые фразы целиком)

const READY_FALLBACK_MS = 6000; // если хук готовности не пришёл — всё равно снять оверлей

class CwasaController {
  private ready = false;
  private busy = false;
  private queue: string[] = [];
  private hooksBound = false;
  private readyTimer: number | null = null;
  private readyListeners = new Set<(ready: boolean) => void>();

  /**
   * Инициализация движка. Вызывается при МОНТИРОВАНИИ контейнера аватара
   * (AvatarPanel), когда `.CWASAAvatar` уже есть в DOM — иначе CWASA не найдёт
   * контейнер при сканировании. Безопасно вызывать повторно (пере-скан DOM).
   */
  init(): void {
    const cwasa = window.CWASA;
    if (!cwasa) {
      console.warn("[CWASA] глобал CWASA не найден — аватар недоступен");
      return;
    }

    // Хуки вешаем один раз — иначе на каждый init() копились бы дубликаты.
    if (!this.hooksBound) {
      this.hooksBound = true;
      cwasa.addHook("avatarloaded", () => this.markReady());
      cwasa.addHook("avatarready", () => this.markReady());
      cwasa.addHook("animidle", () => {
        this.busy = false;
        this.drain();
      });
    }

    // (Пере)сканировать DOM на контейнеры аватара и GUI-элементы (.CWASAAvMenu).
    // Без конфига — дефолтный список аватаров (anna, marc, francoise), который
    // отдаётся сервером vhg по HTTPS с CORS.
    try {
      cwasa.init();
    } catch (e) {
      console.warn("[CWASA] init failed:", (e as Error).message);
    }

    // Подстраховка: некоторые сборки CWASA не шлют avatarready, либо хук
    // отрабатывает до подписки. Чтобы спиннер «Подключение аватара…» не висел
    // вечно поверх уже отрисованного аватара — снимаем его по таймауту.
    if (!this.ready && this.readyTimer === null) {
      this.readyTimer = window.setTimeout(() => this.markReady(), READY_FALLBACK_MS);
    }
  }

  private markReady(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    if (this.ready) return;
    this.ready = true;
    this.readyListeners.forEach((fn) => fn(true));
    this.drain();
  }

  /** Поставить SiGML в очередь. Пустую строку игнорируем (ТЗ §6.6). */
  play(sigml: string | null | undefined): void {
    if (!sigml) return;
    this.queue.push(sigml);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.drain();
  }

  /** Отладка: проиграть жест слова без сессии (ТЗ §6.6). */
  previewSign(word: string): void {
    window.CWASA?.previewSign?.(word);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Подписка на готовность аватара (для индикатора в UI). */
  onReadyChange(fn: (ready: boolean) => void): () => void {
    this.readyListeners.add(fn);
    fn(this.ready);
    return () => this.readyListeners.delete(fn);
  }

  clearQueue(): void {
    this.queue = [];
  }

  private drain(): void {
    if (this.busy || !this.ready || this.queue.length === 0) return;
    const sigml = this.queue.shift()!;
    this.busy = true;
    try {
      window.CWASA?.playSiGMLText(sigml, 0);
    } catch (e) {
      console.warn("[CWASA] playSiGMLText failed:", (e as Error).message);
      this.busy = false;
      this.drain();
    }
  }
}

// Единый экземпляр на приложение.
export const cwasa = new CwasaController();
