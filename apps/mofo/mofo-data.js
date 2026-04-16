/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// ========================================
// 魔坊APP数据层（空壳占位）
// ========================================

export class MofoData {
    constructor(storage) {
        this.storage = storage;
        this._cache = null;
    }

    getBootstrapState() {
        if (!this._cache) {
            this._cache = {
                initializedAt: Date.now()
            };
        }
        return this._cache;
    }

    clearCache() {
        this._cache = null;
    }
}
