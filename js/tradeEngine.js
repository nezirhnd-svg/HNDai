// ==========================
// Trade Engine Module
// ==========================

let activeTrade = null;

function openTrade(signal, price) {

    if (activeTrade) return;

    const risk = 0.01;   // %1 SL
    const reward = 0.02; // %2 TP1

    activeTrade = {

        side: signal,

        entry: price,

        sl:
            signal === "LONG"
                ? price * (1 - risk)
                : price * (1 + risk),

        tp1:
            signal === "LONG"
                ? price * (1 + reward)
                : price * (1 - reward),

        tp2:
            signal === "LONG"
                ? price * 1.04
                : price * 0.96,

        tp3:
            signal === "LONG"
                ? price * 1.06
                : price * 0.94

    };

    console.log("Trade Açıldı", activeTrade);

}

function checkTrade(price) {

    if (!activeTrade) return;

    if (activeTrade.side === "LONG") {

        if (price >= activeTrade.tp3) {

            console.log("TP3");
            activeTrade = null;
            return;

        }

        if (price <= activeTrade.sl) {

            console.log("SL");
            activeTrade = null;
            return;

        }

    }

    if (activeTrade.side === "SHORT") {

        if (price <= activeTrade.tp3) {

            console.log("TP3");
            activeTrade = null;
            return;

        }

        if (price >= activeTrade.sl) {

            console.log("SL");
            activeTrade = null;
            return;

        }

    }

}
