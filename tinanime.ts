/// <reference path="./plugin.d.ts" />  

function init() {  
    $ui.register((ctx) => {  
        const tray = ctx.newTray({  
            tooltipText: "Pirsch News",  
            iconUrl: "https://pirsch.io/static/img/favicon-192.png",  
            withContent: true,  
        });  

        const pageState = ctx.state<"list" | "article">("list");  
        const newsItems = ctx.state<  
            Array<{ title: string; link: string; description: string; imageUrl?: string }>  
        >([]);  
        const currentArticle = ctx.state<{ title: string; content: string } | null>(  
            null  
        );  
        const currentPage = ctx.state(0);  
        const ITEMS_PER_PAGE = 10;  

        async function fetchNews() {  
            try {  
                const res = await ctx.fetch(  
                    "https://rss.app/feeds/azpF5IGCTcm2pPdT.xml"  
                );  
                const txt = await res.text();  

                const items: Array<{ title: string; link: string; description: string; imageUrl?: string }> =  
                    [];  
                const itemMatches = [...txt.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(  
                    0,  
                    50  
                );  
                for (const m of itemMatches) {  
                    const block = m[1];  
                    const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ||  
                        "No title"  
                    )  
                        .replace(/<!\[CDATA\[|\]\]>/g, "")  
                        .trim();  
                    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "#").trim();  
                    
                    // Lấy description từ thẻ <div>  
                    let description = (block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")  
                        .replace(/<!\[CDATA\[|\]\]>/g, "")  
                        .trim();  
                    const divMatch = description.match(/<div>([\s\S]*?)<\/div>/i);  
                    if (divMatch) {  
                        description = divMatch[1]  
                            .replace(/<img[^>]*>/g, "")  
                            .replace(/<[^>]+>/g, "")  
                            .replace(/\s+/g, " ")  
                            .trim();  
                    } else {  
                        description = description  
                            .replace(/<[^>]+>/g, "")  
                            .replace(/\s+/g, " ")  
                            .trim();  
                    }  
                    if (!description) description = "No description available.";  

                    // Lấy URL hình ảnh từ thẻ <media:content> (vẫn giữ để dữ liệu đầy đủ)  
                    const imageUrlMatch = block.match(/<media:content[^>]+url="([^"]+)"/i);  
                    const imageUrl = imageUrlMatch ? imageUrlMatch[1].trim() : undefined;  

                    items.push({ title, link, description, imageUrl });  
                }  

                newsItems.set(items);  
            } catch (err) {  
                console.error("[tray-news-plugin]", err);  
                newsItems.set([]);  
            }  
        }  

        async function safeFetch(url: string, retries = 2, delay = 2000) {  
            for (let i = 0; i <= retries; i++) {  
                try {  
                    const res = await ctx.fetch(url, { timeout: 15000 });  
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);  
                    return await res.text();  
                } catch (err) {  
                    if (i === retries) throw err;  
                    console.warn(`[tray-news-plugin] fetch failed (try ${i + 1}), retrying in ${delay}ms…`);  
                    await new Promise(r => setTimeout(r, delay));  
                }  
            }  
            throw new Error("Failed to fetch after retries");  
        }  

        async function fetchFullArticle(url: string, fallbackDesc?: string) {  
            try {  
                const html = await safeFetch(url);  

                // Tìm khoảng từ <p class="font-large"> đến <div class="entry-bottom mt-50 mb-30"><div class="tags">  
                const contentMatch = html.match(/<p class="font-large">([\s\S]*?)<div class="entry-bottom mt-50 mb-30">[\s\S]*?<div class="tags">/i);  

                if (!contentMatch) return fallbackDesc || "Full content unavailable.";  

                const contentHTML = contentMatch[1];  

                // Tìm tất cả thẻ văn bản (p, span, div, h1-h6, li, strong, em, b, i) và lấy nội dung text  
                const textElements = [...contentHTML.matchAll(/<(p|span|div|h[1-6]|li|strong|em|b|i)[^>]*>([\s\S]*?)<\/\1>/gi)];  
                const texts: string[] = [];  

                for (const m of textElements) {  
                    let text = m[2];  
                    text = text.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, "$1"); // Giữ nội dung link nhưng bỏ tag  
                    text = text.replace(/<[^>]+>/g, ""); // Bỏ hết tag còn lại  
                    text = text.replace(/\s+/g, " ").trim();  
                    if (text) texts.push(text + "\n\n"); // Thêm \n\n sau mỗi đoạn để xuống dòng riêng biệt  
                }  

                if (texts.length) return texts.join(""); // Nối các đoạn mà không thêm khoảng cách thừa  

                return fallbackDesc || "No readable content found.";  
            } catch (err) {  
                console.error("[tray-news-plugin] fetchFullArticle", err);  
                return fallbackDesc || "Failed to load full article.";  
            }  
        }  

        fetchNews();  

        tray.render(() => {  
            if (pageState.get() === "list") {  
                const items = newsItems.get();  
                if (!items.length) return tray.stack([tray.text("Loading news…")]);  

                const page = currentPage.get();  
                const start = page * ITEMS_PER_PAGE;  
                const end = start + ITEMS_PER_PAGE;  
                const pageItems = items.slice(start, end);  

                const stackItems = pageItems.map((it) =>  
                    tray.stack([  
                        tray.flex([  
                            tray.stack([  
                                tray.text(it.title, { style: { fontSize: 12, fontWeight: "bold" } }),  
                                tray.text(it.description.slice(0, 200) + (it.description.length > 200 ? "…" : ""), { style: { fontSize: 11, opacity: 0.8 } }),  
                            ], { style: { flex: 1 } }),  
                            tray.button("Read", {  
                                onClick: ctx.eventHandler(it.link, async () => {  
                                    const fullText = await fetchFullArticle(it.link, it.description);  
                                    currentArticle.set({ title: it.title, content: fullText });  
                                    pageState.set("article");  
                                }),  
                                size: "sm",  
                                intent: "info",  
                            }),  
                        ]),  
                        // Thêm divider giữa các tin tức  
                        tray.text("_____", { style: { fontSize: 12, textAlign: "center", margin: "4px 0", opacity: 0.5 } }),  
                    ])  
                );  

                const pagination = [];  
                if (start > 0)  
                    pagination.push(  
                        tray.button("Prev", {  
                            onClick: ctx.eventHandler("prev-page", () =>  
                                currentPage.set(page - 1)  
                            ),  
                            size: "sm",  
                            intent: "gray-subtle",  
                        })  
                    );  
                if (end < items.length)  
                    pagination.push(  
                        tray.button("Next", {  
                            onClick: ctx.eventHandler("next-page", () =>  
                                currentPage.set(page + 1)  
                            ),  
                            size: "sm",  
                            intent: "gray-subtle",  
                        })  
                    );  

                return tray.stack([...stackItems, tray.flex(pagination, { gap: 1 })]);  
            }  

            if (pageState.get() === "article") {  
                const article = currentArticle.get();  
                if (!article) return tray.stack([tray.text("Loading article…")]);  
                return tray.stack([  
                    tray.button("← Back", {  
                        onClick: ctx.eventHandler("back", () => pageState.set("list")),  
                        size: "sm",  
                        intent: "gray-subtle",  
                    }),  
                    tray.text(article.title, {  
                        style: { fontWeight: "bold", fontSize: 14, margin: "4px 0" },  
                    }),  
                    // Ngăn cách tiêu đề với nội dung bằng _______  
                    tray.text("_______", { style: { fontSize: 12, textAlign: "center", margin: "4px 0", opacity: 0.5 } }),  
                    tray.text(article.content, { style: { fontSize: 12, lineHeight: 1.5 } }), // Giữ lineHeight cho dễ đọc  
                ]);  
            }  
        });  

        ctx.setInterval(fetchNews, 10 * 60 * 1000);  
    });  
}
