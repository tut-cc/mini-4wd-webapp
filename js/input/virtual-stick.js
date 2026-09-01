/**
 * 仮想ジョイスティック (Pointer Events API 対応)
 * タッチとマウスの両方を単一のイベントフローで処理します。
 */

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
const applyDeadband = (val, db) => (Math.abs(val) < db ? 0.0 : val);

export class VirtualStick {
    constructor({ zoneElement, baseElement, thumbElement, axis = 'y', maxDistance = 60, deadband = 0.05 }) {
        this.zone = zoneElement;
        this.base = baseElement;
        this.thumb = thumbElement;
        this.axis = axis; // 'y': 前後 (スロットル), 'x': 左右 (ステアリング)
        this.maxDist = maxDistance;
        this.deadband = deadband;

        this.pointerId = null;
        this.startPos = 0;
        this.value = 0.0;
        this.enabled = true;

        this.initEvents();
    }

    initEvents() {
        if (!this.zone || !this.base || !this.thumb) return;

        this.zone.addEventListener('pointerdown', (e) => {
            if (!this.enabled || this.pointerId !== null || (e.button !== undefined && e.button !== 0)) return;
            e.preventDefault();

            this.pointerId = e.pointerId;
            try { this.zone.setPointerCapture(e.pointerId); } catch (_) {}

            const rect = this.zone.getBoundingClientRect();
            this.base.style.left = `${e.clientX - rect.left}px`;
            this.base.style.top = `${e.clientY - rect.top}px`;
            this.thumb.style.transform = 'translate(-50%, -50%)';
            this.base.classList.remove('hidden');

            this.startPos = (this.axis === 'y') ? e.clientY : e.clientX;
            this.value = 0.0;
        });

        this.zone.addEventListener('pointermove', (e) => {
            if (this.pointerId !== e.pointerId) return;
            e.preventDefault();

            const currentPos = (this.axis === 'y') ? e.clientY : e.clientX;
            const delta = (this.axis === 'y') ? (this.startPos - currentPos) : (currentPos - this.startPos);
            this.value = applyDeadband(clamp(delta / this.maxDist, -1.0, 1.0), this.deadband);

            const visualOffset = (this.axis === 'y' ? -this.value : this.value) * (this.maxDist * 0.5);
            this.thumb.style.transform = (this.axis === 'y')
                ? `translate(-50%, calc(-50% + ${visualOffset}px))`
                : `translate(calc(-50% + ${visualOffset}px), -50%)`;
        });

        const onEnd = (e) => {
            if (this.pointerId !== e.pointerId) return;
            try { this.zone.releasePointerCapture?.(e.pointerId); } catch (_) {}
            this.pointerId = null;
            this.value = 0.0;
            this.base.classList.add('hidden');
        };

        this.zone.addEventListener('pointerup', onEnd);
        this.zone.addEventListener('pointercancel', onEnd);
    }

    reset() {
        this.pointerId = null;
        this.value = 0.0;
        this.base?.classList.add('hidden');
    }

    isActive() {
        return this.pointerId !== null;
    }

    getValue() {
        return this.enabled ? this.value : 0.0;
    }
}
