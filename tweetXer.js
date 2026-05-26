// ==UserScript==
// @name         TweetXer
// @namespace    https://github.com/lucahammer/tweetXer/
// @version      0.9.4
// @description  Delete all your Tweets for free.
// @author       Luca,dbort,pReya,Micolithe,STrRedWolf
// @license      NoHarm-draft
// @match        https://x.com/*
// @match        https://mobile.x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @icon         https://www.google.com/s2/favicons?domain=twitter.com
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/476062/TweetXer.user.js
// @updateURL    https://update.greasyfork.org/scripts/476062/TweetXer.meta.js
// @supportURL   https://github.com/lucahammer/tweetXer/issues
// ==/UserScript==

(function () {
    let TweetsXer = {
        version: '0.9.4',
        TweetCount: 0,
        dId: "exportUpload",
        tIds: [],
        tId: "",
        ratelimitreset: 0,
        more: '[data-testid="tweet"] [data-testid="caret"]',
        skip: 0,
        total: 0,
        dCount: 0,
        deleteURL: '/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet',
        unfavURL: '/i/api/graphql/ZYKSe-w7KEslx3JhSIk5LA/UnfavoriteTweet',
        deleteMessageURL: '/i/api/graphql/BJ6DtxA2llfjnRoRjaiIiw/DMMessageDeleteMutation',
        deleteConvoURL: '/i/api/1.1/dm/conversation/USER_ID-CONVERSATION_ID/delete.json',
        deleteDMsOneByOne: false,
        username: '',
        action: '',
        bookmarksURL: '/i/api/graphql/L7vvM2UluPgWOW4GDvWyvw/Bookmarks?',
        bookmarks: [],
        bookmarksNext: '',
        baseUrl: 'https://x.com',
        authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        ct0: false,
        transaction_id: '',
        startTime: 0,
        startCount: 0,
        pauseEvery: 190,
        pauseMinutes: 15,
        spareThreshold: 0,
        liveLikes: false,
        sparedCount: 0,
        // TweetResultByRestId query id. X rotates these; if live like lookups
        // return 400/404, copy the current one from the DevTools Network tab.
        tweetResultQueryId: '7xflPyRiUxGVbJd4uWmbKg',

        async init() {
            this.baseUrl = `https://${window.location.hostname}`
            this.updateTransactionId()
            this.createUploadForm()
            await this.getTweetCount()
            this.ct0 = this.getCookie('ct0')
            this.username = document.location.href.split('/')[3].replace('#', '')
        },

        sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms))
        },

        getCookie(name) {
            const match = `; ${document.cookie}`.match(`;\\s*${name}=([^;]+)`)
            return match ? match[1] : null
        },

        updateTransactionId() {
            // random string
            this.transaction_id = [...crypto.getRandomValues(new Uint8Array(95))]
                .map((x, i) => (i = x / 255 * 61 | 0, String.fromCharCode(i + (i > 9 ? i > 35 ? 61 : 55 : 48)))).join``
        },

        updateTitle(text) {
            document.getElementById('tweetsXer_title').textContent = text
        },

        updateInfo(text) {
            document.getElementById("info").textContent = text
        },

        formatDuration(s) {
            if (!isFinite(s) || s <= 0) return '—'
            s = Math.round(s)
            const h = Math.floor(s / 3600)
            const m = Math.floor((s % 3600) / 60)
            const sec = s % 60
            if (h) return `${h}h ${m}m`
            if (m) return `${m}m ${sec}s`
            return `${sec}s`
        },

        readSettings() {
            const every = parseInt(document.getElementById('pauseEvery')?.value, 10)
            this.pauseEvery = isNaN(every) ? 190 : every
            const mins = parseFloat(document.getElementById('pauseMinutes')?.value)
            this.pauseMinutes = isNaN(mins) ? 15 : mins
            const likes = parseInt(document.getElementById('spareLikes')?.value, 10)
            this.spareThreshold = isNaN(likes) ? 0 : likes
            this.liveLikes = !!(document.getElementById('liveLikes')?.checked)
        },

        // Keep tweets with more than the chosen number of likes.
        // Like counts are only present in tweets.js, not in tweet-headers.js.
        filterByLikes(entries) {
            // Live mode looks up current like counts inline during deletion instead.
            if (document.getElementById('liveLikes')?.checked) return entries
            const spareLikes = parseInt(document.getElementById('spareLikes')?.value, 10) || 0
            if (spareLikes <= 0) return entries
            if (!entries.length || entries[0].tweet.favorite_count === undefined) {
                this.updateInfo('This file has no like counts. Use tweets.js to spare tweets by likes.')
                console.warn('favorite_count not found. Like-based sparing requires tweets.js.')
                return entries
            }
            const before = entries.length
            const kept = entries.filter((x) => !(parseInt(x.tweet.favorite_count, 10) > spareLikes))
            console.log(`Sparing ${before - kept.length} tweet(s) with more than ${spareLikes} likes.`)
            return kept
        },

        // Spare the most recent N days of tweets. The creation time is decoded
        // from the tweet's Snowflake ID, so this works for any tweet file.
        filterByDays(ids) {
            const days = parseInt(document.getElementById('skipDays')?.value, 10) || 0
            if (days <= 0) return ids
            const cutoff = Date.now() - days * 86400000
            const epoch = 1288834974657n // Twitter Snowflake epoch (2010-11-04)
            const before = ids.length
            const kept = ids.filter((id) => {
                try {
                    return Number((BigInt(id) >> 22n) + epoch) < cutoff
                } catch (_) {
                    return true
                }
            })
            console.log(`Sparing ${before - kept.length} tweet(s) from the last ${days} day(s).`)
            return kept
        },

        // Pause for pauseMinutes after every pauseEvery deletions in this run.
        async maybePause() {
            if (!this.pauseEvery || this.pauseEvery <= 0) return
            const done = this.dCount - this.startCount
            if (done <= 0 || done % this.pauseEvery !== 0) return
            const titleEl = document.getElementById('tweetsXer_title')
            const prevTitle = titleEl ? titleEl.textContent : ''
            this.updateTitle('TweetXer: Paused')
            let remaining = Math.round(this.pauseMinutes * 60)
            while (remaining > 0) {
                this.updateInfo(`Pausing ${this.formatDuration(remaining)} after ${done.toLocaleString()} deletions to avoid rate limits…`)
                await this.sleep(1000)
                remaining--
            }
            this.updateTitle(prevTitle)
        },

        // Look up a tweet's current like count via GraphQL.
        // Returns a number, or null if it can't be determined.
        async getLikeCount(id) {
            const variables = JSON.stringify({ tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false })
            const features = JSON.stringify({
                creator_subscriptions_tweet_preview_api_enabled: true,
                communities_web_enable_tweet_community_results_fetch: true,
                c9s_tweet_anatomy_moderator_badge_enabled: true,
                articles_preview_enabled: true,
                responsive_web_edit_tweet_api_enabled: true,
                graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
                view_counts_everywhere_api_enabled: true,
                longform_notetweets_consumption_enabled: true,
                responsive_web_twitter_article_tweet_consumption_enabled: true,
                tweet_awards_web_tipping_enabled: false,
                creator_subscriptions_quote_tweet_preview_enabled: false,
                freedom_of_speech_not_reach_fetch_enabled: true,
                standardized_nudges_misinfo: true,
                tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
                rweb_video_timestamps_enabled: true,
                longform_notetweets_rich_text_read_enabled: true,
                longform_notetweets_inline_media_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
                responsive_web_enhance_cards_enabled: false,
                rweb_tipjar_consumption_enabled: true,
                premium_content_api_read_enabled: false,
                responsive_web_grok_analyze_button_fetch_trends_enabled: false,
                responsive_web_grok_analyze_post_followups_enabled: false,
                responsive_web_grok_share_attachment_enabled: false,
                profile_label_improvements_pcf_label_in_post_enabled: false,
                responsive_web_grok_image_annotation_enabled: false,
                tweetypie_unmention_optimization_enabled: true
            })
            const fieldToggles = JSON.stringify({ withArticleRichContentState: true, withArticlePlainText: false, withGrokAnalyze: false, withDisallowedReplyControls: false })
            const url = `${this.baseUrl}/i/api/graphql/${this.tweetResultQueryId}/TweetResultByRestId?` + new URLSearchParams({ variables, features, fieldToggles })

            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const response = await fetch(url, {
                        headers: {
                            authorization: this.authorization,
                            'content-type': 'application/json',
                            'x-client-transaction-id': this.transaction_id,
                            'x-csrf-token': this.ct0,
                            'x-twitter-active-user': 'yes',
                            'x-twitter-auth-type': 'OAuth2Session'
                        },
                        referrer: `${this.baseUrl}/${this.username}`,
                        referrerPolicy: 'strict-origin-when-cross-origin',
                        method: 'GET',
                        mode: 'cors',
                        credentials: 'include',
                        signal: AbortSignal.timeout(5000)
                    })

                    if (response.status === 200) {
                        const data = await response.json()
                        let result = data?.data?.tweetResult?.result
                        if (result && result.tweet) result = result.tweet
                        const likes = result?.legacy?.favorite_count
                        return likes == null ? null : parseInt(likes, 10)
                    }
                    if (response.status === 429) {
                        const reset = parseInt(response.headers.get('x-rate-limit-reset'), 10)
                        let sleeptime = reset ? reset - Math.floor(Date.now() / 1000) : 60
                        while (sleeptime > 0) {
                            this.updateInfo(`Ratelimited reading likes. Waiting ${sleeptime}s. ${this.dCount} deleted.`)
                            await this.sleep(1000)
                            sleeptime = reset ? reset - Math.floor(Date.now() / 1000) : sleeptime - 1
                        }
                        continue
                    }
                    console.log(`Like lookup failed (HTTP ${response.status}). You may need to update tweetResultQueryId/features.`)
                    return null
                } catch (error) {
                    console.log('Like lookup error:', error)
                    return null
                }
            }
            return null
        },

        createProgressBar() {
            const drop = document.getElementById('tx-drop')
            if (drop) drop.remove()

            this.startTime = Date.now()
            this.startCount = this.dCount

            const area = document.getElementById('tx-progress-area') || document.getElementById(this.dId)
            if (document.getElementById('progressbar')) document.getElementById('progressbar').remove()

            const wrap = document.createElement('div')
            wrap.id = 'progressbar'
            wrap.className = 'tx-progress'
            wrap.innerHTML = `
                <div class="tx-progress-head"><span>Progress</span><span class="tx-pct">0%</span></div>
                <div class="tx-track"><div class="tx-fill"></div></div>
                <div class="tx-stats">
                    <span class="tx-stat-count">0 / 0</span>
                    <span class="tx-stat-rate">—</span>
                    <span class="tx-stat-eta">ETA —</span>
                </div>`
            area.appendChild(wrap)
            this.updateProgressBar()
        },

        updateProgressBar() {
            const pb = document.getElementById('progressbar')
            if (!pb) return

            const total = this.total || 0
            const pct = total > 0 ? Math.min(100, (this.dCount / total) * 100) : 0
            pb.querySelector('.tx-fill').style.width = `${pct}%`
            pb.querySelector('.tx-pct').textContent = `${pct >= 100 ? '100' : pct.toFixed(1)}%`
            pb.querySelector('.tx-stat-count').textContent = `${this.dCount.toLocaleString()} / ${total.toLocaleString()}`

            const elapsed = (Date.now() - this.startTime) / 1000
            const done = this.dCount - this.startCount
            const rate = (done > 0 && elapsed > 0) ? done / elapsed : 0
            pb.querySelector('.tx-stat-rate').textContent = rate <= 0
                ? '—'
                : (rate >= 1 ? `${rate.toFixed(1)}/s` : `${(rate * 60).toFixed(0)}/min`)

            const remaining = Math.max(0, total - this.dCount)
            pb.querySelector('.tx-stat-eta').textContent = `ETA ${rate > 0 ? this.formatDuration(remaining / rate) : '—'}`

            this.updateInfo(`Working… most recent ID: ${this.tId || '—'}`)
        },

        processFile() {
            const tn = document.getElementById(`${TweetsXer.dId}_file`)
            if (tn.files && tn.files[0]) {
                let fr = new FileReader()
                fr.onloadend = function (evt) {
                    // window.YTD.tweet_headers.part0
                    // window.YTD.tweets.part0
                    // window.YTD.like.part0
                    // window.YTD.direct_message_headers.part0
                    let cutpoint = evt.target.result.indexOf('= ')
                    let filestart = evt.target.result.slice(0, cutpoint)
                    let json = JSON.parse(evt.target.result.slice(cutpoint + 1))

                    if (filestart.includes('.tweet_headers.')) {
                        console.log('File contains Tweets.')
                        TweetsXer.action = 'untweet'
                        TweetsXer.tIds = TweetsXer.filterByDays(TweetsXer.filterByLikes(json).map((x) => x.tweet.tweet_id))
                    } else if (filestart.includes('.tweets.') || filestart.includes('.tweet.')) {
                        console.log('File contains Tweets.')
                        TweetsXer.action = 'untweet'
                        TweetsXer.tIds = TweetsXer.filterByDays(TweetsXer.filterByLikes(json).map((x) => x.tweet.id_str))
                    } else if (filestart.includes('.like.')) {
                        console.log('File contains Favs.')
                        TweetsXer.action = 'unfav'
                        TweetsXer.tIds = json.map((x) => x.like.tweetId)
                    }
                    else if (
                        filestart.includes('.direct_message_headers.')
                        || filestart.includes('.direct_message_group_headers.')
                        || filestart.includes('.direct_messages.')
                        || filestart.includes('.direct_message_groups.')) {
                        console.log('File contains Direct Messages.')
                        TweetsXer.action = 'undm'
                        if (this.deleteDMsOneByOne) {
                            TweetsXer.tIds = json.map((c) => c.dmConversation.messages.map((m) => m.messageCreate ? m.messageCreate.id : 0))
                            TweetsXer.tIds = TweetsXer.tIds.flat()
                            TweetsXer.tIds = TweetsXer.tIds.filter((i) => i != 0)
                        }
                        else {
                            TweetsXer.tIds = json.map((c) => c.dmConversation.conversationId)
                        }

                    } else {
                        TweetsXer.updateInfo('File content not recognized. Please use a file from the Twitter data export.')
                        console.log('File content not recognized. Please use a file from the Twitter data export.')
                    }

                    if (TweetsXer.action.length > 0) {
                        TweetsXer.readSettings()
                        TweetsXer.total = TweetsXer.tIds.length
                        document.getElementById(`${TweetsXer.dId}_file`).remove()
                        TweetsXer.createProgressBar()
                    }

                    if (TweetsXer.action == 'untweet') {
                        if (document.getElementById('skipCount').value.length < 1) {
                            // If there is no amount set to skip, automatically try to skip the amount
                            // that has been deleted already. Difference of Tweeets in file to count on profile
                            // 5% tolerance to prevent skipping too much
                            TweetsXer.skip = TweetsXer.total - TweetsXer.TweetCount - parseInt(TweetsXer.total / 20)
                            TweetsXer.skip = Math.max(0, TweetsXer.skip)
                        }
                        else {
                            TweetsXer.skip = document.getElementById('skipCount').value
                        }
                        console.log(`Skipping oldest ${TweetsXer.skip} Tweets. Use advanced options to manually set how many to skip. Enter 0 to prevent the automatic calculation.`)
                        TweetsXer.tIds.reverse()
                        TweetsXer.tIds = TweetsXer.tIds.slice(TweetsXer.skip)
                        TweetsXer.dCount = TweetsXer.skip
                        TweetsXer.tIds.reverse()
                        TweetsXer.updateTitle(`TweetXer: Deleting ${TweetsXer.total} Tweets`)

                        TweetsXer.deleteTweets()
                    } else if (TweetsXer.action == 'unfav') {
                        TweetsXer.skip = document.getElementById('skipCount').value.length > 0 ? document.getElementById('skipCount').value : 0
                        console.log(`Skipping oldest ${TweetsXer.skip} Tweets`)
                        TweetsXer.tIds = TweetsXer.tIds.slice(TweetsXer.skip)
                        TweetsXer.dCount = TweetsXer.skip
                        TweetsXer.tIds.reverse()
                        TweetsXer.updateTitle(`TweetXer: Deleting ${TweetsXer.total} Favs`)
                        TweetsXer.deleteFavs()
                    } else if (TweetsXer.action == 'undm') {
                        TweetsXer.skip = document.getElementById('skipCount').value.length > 0 ? document.getElementById('skipCount').value : 0
                        console.log(`Skipping ${TweetsXer.skip} messages/convos`)
                        TweetsXer.tIds = TweetsXer.tIds.slice(TweetsXer.skip)
                        TweetsXer.dCount = TweetsXer.skip
                        TweetsXer.tIds.reverse()
                        if (this.deleteDMsOneByOne) {
                            TweetsXer.updateTitle(`TweetXer: Deleting ${TweetsXer.total} DMs`)
                            TweetsXer.deleteDMs()
                        }
                        else {
                            TweetsXer.updateTitle(`TweetXer: Deleting ${TweetsXer.total} DM Conversations`)
                            TweetsXer.deleteConvos()
                        }

                    }
                    else {
                        TweetsXer.updateTitle(`TweetXer: Please try a different file`)
                    }

                }
                fr.readAsText(tn.files[0])
            }
        },

        createUploadForm() {
            const dId = this.dId
            if (document.getElementById(dId)) { document.getElementById(dId).remove() }
            const div = document.createElement("div")
            div.id = dId
            div.innerHTML = `
            <style>
            #${dId},#${dId} *{box-sizing:border-box}
            #${dId}{
                --tx-accent:#1d9bf0;--tx-danger:#f4212e;
                --tx-text:#e7e9ea;--tx-muted:#71767b;--tx-card:rgba(255,255,255,.05);--tx-border:rgba(255,255,255,.12);
                position:fixed;top:16px;left:50%;transform:translateX(-50%);
                width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow-y:auto;
                z-index:2147483647;margin:0;padding:0;
                background:rgba(21,24,28,.94);backdrop-filter:blur(14px) saturate(150%);-webkit-backdrop-filter:blur(14px) saturate(150%);
                color:var(--tx-text);font-family:"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
                font-size:15px;line-height:1.45;text-align:left;
                border:1px solid var(--tx-border);border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.55);
                -webkit-font-smoothing:antialiased;animation:tx-in .25s ease both;
                scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.25) transparent;
            }
            @keyframes tx-in{from{opacity:0;transform:translateX(-50%) translateY(-14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
            #${dId}::-webkit-scrollbar{width:8px}
            #${dId}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:8px}
            #${dId} .tx-header{display:flex;align-items:center;gap:12px;padding:14px 16px;position:sticky;top:0;z-index:2;cursor:grab;user-select:none;background:rgba(21,24,28,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--tx-border)}
            #${dId} .tx-header:active{cursor:grabbing}
            #${dId} .tx-badge{flex:0 0 auto;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--tx-danger),#ff5b66);color:#fff;box-shadow:0 4px 12px rgba(244,33,46,.4)}
            #${dId} .tx-htext{flex:1 1 auto;min-width:0}
            #${dId} #tweetsXer_title{margin:0;font-size:17px;font-weight:800;letter-spacing:-.2px;color:var(--tx-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            #${dId} .tx-sub{font-size:12px;color:var(--tx-muted);font-weight:500}
            #${dId} .tx-iconbtn{flex:0 0 auto;width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--tx-muted);background:transparent;transition:.15s}
            #${dId} .tx-iconbtn:hover{background:rgba(255,255,255,.1);color:var(--tx-text)}
            #${dId} #removeTweetXer:hover{background:rgba(244,33,46,.15);color:var(--tx-danger)}
            #${dId} .tx-body{padding:16px}
            #${dId}.tx-min{width:min(320px,calc(100vw - 24px))}
            #${dId}.tx-min .tx-body{display:none}
            #${dId} #info{margin:0 0 14px;font-size:14px;color:var(--tx-muted)}
            #${dId} #tx-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px 16px;border:2px dashed var(--tx-border);border-radius:16px;cursor:pointer;text-align:center;transition:.15s;color:var(--tx-muted);background:var(--tx-card)}
            #${dId} #tx-drop:hover,#${dId} #tx-drop.tx-dragover{border-color:var(--tx-accent);color:var(--tx-text);background:rgba(29,155,240,.08)}
            #${dId} #tx-drop .tx-drop-icon{color:var(--tx-accent)}
            #${dId} #tx-drop strong{color:var(--tx-text);font-weight:700;font-size:15px}
            #${dId} #tx-drop span{font-size:13px;line-height:1.5}
            #${dId} #${dId}_file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)}
            #${dId} .tx-adv-toggle{width:100%;margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;background:transparent;border:none;color:var(--tx-muted);font-size:14px;font-weight:600;cursor:pointer;padding:8px;border-radius:10px;font-family:inherit}
            #${dId} .tx-adv-toggle:hover{color:var(--tx-text);background:rgba(255,255,255,.05)}
            #${dId} .tx-chevron{transition:transform .2s}
            #${dId} .tx-adv-toggle.tx-open .tx-chevron{transform:rotate(180deg)}
            #${dId} #advanced{max-height:0;overflow:hidden;transition:max-height .3s ease}
            #${dId} #advanced.tx-open{max-height:2200px;margin-top:8px}
            #${dId} .tx-section{background:var(--tx-card);border:1px solid var(--tx-border);border-radius:14px;padding:14px;margin-bottom:10px}
            #${dId} .tx-section h4{margin:0 0 4px;font-size:14px;font-weight:700;color:var(--tx-text)}
            #${dId} .tx-section p{margin:0 0 10px;font-size:13px;color:var(--tx-muted)}
            #${dId} .tx-section ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--tx-muted)}
            #${dId} .tx-section li{margin:3px 0}
            #${dId} .tx-label{display:block;font-size:13px;color:var(--tx-muted);margin-bottom:6px}
            #${dId} .tx-input{width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--tx-border);background:rgba(0,0,0,.25);color:var(--tx-text);font-size:14px;font-family:inherit;outline:none;transition:.15s}
            #${dId} .tx-input:focus{border-color:var(--tx-accent);box-shadow:0 0 0 3px rgba(29,155,240,.25)}
            #${dId} .tx-input+.tx-label{margin-top:12px}
            #${dId} .tx-check{display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:13px;color:var(--tx-muted);cursor:pointer;line-height:1.4}
            #${dId} .tx-check input{flex:0 0 auto;width:16px;height:16px;margin-top:1px;accent-color:var(--tx-accent);cursor:pointer}
            #${dId} .tx-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px 16px;border-radius:999px;border:1px solid transparent;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;transition:.15s}
            #${dId} .tx-btn-ghost{background:transparent;border-color:var(--tx-border);color:var(--tx-text)}
            #${dId} .tx-btn-ghost:hover{background:rgba(255,255,255,.08)}
            #${dId} .tx-btn-danger{background:transparent;border-color:rgba(244,33,46,.5);color:var(--tx-danger)}
            #${dId} .tx-btn-danger:hover{background:rgba(244,33,46,.12)}
            #${dId} a{color:var(--tx-accent);text-decoration:none}
            #${dId} a:hover{text-decoration:underline}
            #${dId} #bookmarksDownload{display:inline-block;margin-top:10px;font-weight:700}
            #${dId} .tx-progress{margin-top:14px}
            #${dId} .tx-progress-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
            #${dId} .tx-progress-head span:first-child{font-size:13px;color:var(--tx-muted);font-weight:600}
            #${dId} .tx-pct{font-size:18px;font-weight:800;color:var(--tx-accent)}
            #${dId} .tx-track{height:10px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
            #${dId} .tx-fill{height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,var(--tx-accent),#5cc0ff);transition:width .3s ease}
            #${dId} .tx-stats{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:12px;color:var(--tx-muted);font-variant-numeric:tabular-nums}
            #${dId} .tx-foot{margin-top:14px;text-align:center;font-size:11px;color:var(--tx-muted)}
            @media (max-width:480px){#${dId}{top:8px;width:calc(100vw - 16px);border-radius:16px}}
            </style>
            <div class="tx-header" id="tx-header">
                <div class="tx-badge"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></div>
                <div class="tx-htext">
                    <h2 id="tweetsXer_title">TweetXer</h2>
                    <div class="tx-sub">eXterminate your tweets</div>
                </div>
                <button class="tx-iconbtn" id="tx-min" type="button" title="Minimize"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
                <button class="tx-iconbtn" id="removeTweetXer" type="button" title="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
            <div class="tx-body">
                <p id="info">Please wait for your profile to load. If this message doesn't go away after a few seconds, something isn't working.</p>
                <div id="start">
                    <label id="tx-drop" for="${dId}_file">
                        <div class="tx-drop-icon"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div>
                        <strong>Choose your data file</strong>
                        <span>Drag &amp; drop or click to select<br>tweet-headers.js · like.js · direct-message-headers.js</span>
                    </label>
                    <input type="file" value="" id="${dId}_file" />
                    <button type="button" class="tx-adv-toggle" id="toggleAdvanced"><svg class="tx-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg> Advanced options</button>
                </div>
                <div id="tx-progress-area"></div>
                <div id="advanced">
                    <div class="tx-section">
                        <h4>Filters</h4>
                        <label class="tx-label" for="skipCount">Skip the oldest N items (empty = auto-detect)</label>
                        <input id="skipCount" type="number" class="tx-input" value="" placeholder="0" />
                        <label class="tx-label" for="spareLikes">Spare tweets with more than N likes (needs tweets.js)</label>
                        <input id="spareLikes" type="number" class="tx-input" value="" placeholder="e.g. 100" />
                        <label class="tx-label" for="skipDays">Spare tweets from the last N days</label>
                        <input id="skipDays" type="number" class="tx-input" value="" placeholder="e.g. 30" />
                        <label class="tx-check"><input type="checkbox" id="liveLikes" /> Fetch live like counts from X (works with tweet-headers.js; one extra request per tweet, slower)</label>
                    </div>
                    <div class="tx-section">
                        <h4>Auto-pause</h4>
                        <p>Pause periodically to dodge rate limits and account locks.</p>
                        <label class="tx-label" for="pauseEvery">Pause after every N deletions</label>
                        <input id="pauseEvery" type="number" class="tx-input" value="190" />
                        <label class="tx-label" for="pauseMinutes">Pause duration (minutes)</label>
                        <input id="pauseMinutes" type="number" class="tx-input" value="15" />
                    </div>
                    <div class="tx-section">
                        <h4>Supported files</h4>
                        <ul>
                            <li><strong>tweet-headers.js</strong> — delete Tweets (10k–20k / hour)</li>
                            <li><strong>direct-message-headers.js</strong> &amp; <strong>direct-message-group-headers.js</strong> — delete DMs (~800 / 15 min)</li>
                            <li><strong>like.js</strong> — remove Likes (500 / 15 min, recent only)</li>
                        </ul>
                    </div>
                    <div class="tx-section">
                        <h4>Export bookmarks</h4>
                        <p>Bookmarks aren't included in the official data export. You can export them here.</p>
                        <button id="exportBookmarks" type="button" class="tx-btn tx-btn-ghost">Export bookmarks</button>
                    </div>
                    <div class="tx-section">
                        <h4>No tweet-headers.js?</h4>
                        <p>If you can't get your data export, delete directly from your profile. Much slower and less reliable — at most ~4000 Tweets / hour.</p>
                        <button id="slowDelete" type="button" class="tx-btn tx-btn-ghost">Slow delete without file</button>
                    </div>
                    <div class="tx-section">
                        <h4>Unfollow everyone</h4>
                        <p>It's time to let go. This will unfollow everyone you follow.</p>
                        <button id="unfollowEveryone" type="button" class="tx-btn tx-btn-danger">Unfollow everyone</button>
                    </div>
                    <div class="tx-foot">TweetXer v${this.version}</div>
                </div>
            </div>
                `
            document.body.insertBefore(div, document.body.firstChild)

            document.getElementById("toggleAdvanced").addEventListener("click", () => {
                document.getElementById('advanced').classList.toggle('tx-open')
                document.getElementById('toggleAdvanced').classList.toggle('tx-open')
            })
            document.getElementById("tx-min").addEventListener("click", () => {
                document.getElementById(dId).classList.toggle('tx-min')
            })
            document.getElementById(`${dId}_file`).addEventListener("change", this.processFile, false)
            document.getElementById("exportBookmarks").addEventListener("click", this.exportBookmarks, false)
            document.getElementById("slowDelete").addEventListener("click", this.slowDelete, false)
            document.getElementById("unfollowEveryone").addEventListener("click", this.unfollow, false)
            document.getElementById("removeTweetXer").addEventListener("click", this.removeTweetXer, false)

            // Drag & drop file support
            const drop = document.getElementById('tx-drop')
            const fileInput = document.getElementById(`${dId}_file`)
            ;['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
                e.preventDefault(); e.stopPropagation(); drop.classList.add('tx-dragover')
            }))
            ;['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
                e.preventDefault(); e.stopPropagation(); drop.classList.remove('tx-dragover')
            }))
            drop.addEventListener('drop', (e) => {
                if (e.dataTransfer.files && e.dataTransfer.files.length) {
                    fileInput.files = e.dataTransfer.files
                    fileInput.dispatchEvent(new Event('change'))
                }
            })

            // Draggable panel via the header
            const panel = document.getElementById(dId)
            const header = document.getElementById('tx-header')
            let dragging = false, offX = 0, offY = 0
            header.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.tx-iconbtn')) return
                dragging = true
                const r = panel.getBoundingClientRect()
                panel.style.transform = 'none'
                panel.style.left = `${r.left}px`
                panel.style.top = `${r.top}px`
                panel.style.right = 'auto'
                offX = e.clientX - r.left
                offY = e.clientY - r.top
                header.setPointerCapture(e.pointerId)
            })
            header.addEventListener('pointermove', (e) => {
                if (!dragging) return
                const w = panel.offsetWidth, h = panel.offsetHeight
                const nx = Math.max(6, Math.min(window.innerWidth - w - 6, e.clientX - offX))
                const ny = Math.max(6, Math.min(window.innerHeight - h - 6, e.clientY - offY))
                panel.style.left = `${nx}px`
                panel.style.top = `${ny}px`
            })
            const endDrag = (e) => {
                if (!dragging) return
                dragging = false
                try { header.releasePointerCapture(e.pointerId) } catch (_) { }
            }
            header.addEventListener('pointerup', endDrag)
            header.addEventListener('pointercancel', endDrag)
        },

        async exportBookmarks() {
            TweetsXer.updateTitle('TweetXer: Exporting bookmarks')
            let variables = ''
            while (TweetsXer.bookmarksNext.length > 0 || TweetsXer.bookmarks.length == 0) {
                if (TweetsXer.bookmarksNext.length > 0) {
                    variables = `{"count":20,"cursor":"${TweetsXer.bookmarksNext}","includePromotedContent":false}`
                } else variables = '{"count":20,"includePromotedContent":false}'
                let response = await fetch(TweetsXer.baseUrl + TweetsXer.bookmarksURL + new URLSearchParams({
                    variables: variables,
                    features: '{"graphql_timeline_v2_bookmark_timeline":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"articles_preview_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true,"tweet_awards_web_tipping_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"rweb_video_timestamps_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_enhance_cards_enabled":false}'
                }), {
                    "headers": {
                        "authorization": TweetsXer.authorization,
                        "content-type": "application/json",
                        "x-client-transaction-id": TweetsXer.transaction_id,
                        "x-csrf-token": TweetsXer.ct0,
                        "x-twitter-active-user": "yes",
                        "x-twitter-auth-type": "OAuth2Session",
                    },
                    "referrer": `${TweetsXer.baseUrl}/i/bookmarks`,
                    "referrerPolicy": "strict-origin-when-cross-origin",
                    "method": "GET",
                    "mode": "cors",
                    "credentials": "include"
                })

                if (response.status == 200) {
                    let data = await response.json()
                    data.data.bookmark_timeline_v2.timeline.instructions[0].entries.forEach((item) => {

                        if (item.entryId.includes('tweet')) {
                            TweetsXer.dCount++
                            TweetsXer.bookmarks.push(item.content.itemContent.tweet_results.result)
                        } else if (item.entryId.includes('cursor-bottom')) {
                            if (TweetsXer.bookmarksNext != item.content.value) {
                                TweetsXer.bookmarksNext = item.content.value
                            } else {
                                TweetsXer.bookmarksNext = ''
                            }
                        }
                    })
                    //document.getElementById('progressbar').setAttribute('value', TweetsXer.dCount)
                    TweetsXer.updateInfo(`${TweetsXer.dCount} Bookmarks collected`)
                } else {
                    console.log(response)
                }

                if (!response.headers.get('x-rate-limit-remaining') && response.headers.get('x-rate-limit-remaining') < 1) {
                    console.log('rate limit hit')
                    TweetsXer.ratelimitreset = response.headers.get('x-rate-limit-reset')
                    let sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                    while (sleeptime > 0) {
                        sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                        TweetsXer.updateInfo(`Ratelimited. Waiting ${sleeptime} seconds. ${TweetsXer.dCount} deleted.`)
                        await TweetsXer.sleep(1000)
                    }
                }
            }
            let download = new Blob([JSON.stringify(TweetsXer.bookmarks)], {
                type: 'text/plain'
            })
            let bookmarksDownload = document.createElement("a")
            bookmarksDownload.id = 'bookmarksDownload'
            bookmarksDownload.innerText = 'Download bookmarks'
            bookmarksDownload.href = window.URL.createObjectURL(download)
            bookmarksDownload.download = 'twitter-bookmarks.json'
            document.getElementById('advanced').appendChild(bookmarksDownload)
            TweetsXer.updateTitle('TweetXer')
        },

        async sendRequest(
            url,
            body = `{\"variables\":{\"tweet_id\":\"${TweetsXer.tId}\",\"dark_request\":false},\"queryId\":\"${url.split('/')[6]}\"}`
        ) {
            return new Promise(async (resolve) => {
                try {
                    let response = await fetch(url, {
                        "headers": {
                            "authorization": TweetsXer.authorization,
                            "content-type": "application/json",
                            "x-client-transaction-id": TweetsXer.transaction_id,
                            "x-csrf-token": TweetsXer.ct0,
                            "x-twitter-active-user": "yes",
                            "x-twitter-auth-type": "OAuth2Session"
                        },
                        "referrer": `${TweetsXer.baseUrl}/${TweetsXer.username}/with_replies`,
                        "referrerPolicy": "strict-origin-when-cross-origin",
                        "body": body,
                        "method": "POST",
                        "mode": "cors",
                        "credentials": "include",
                        "signal": AbortSignal.timeout(5000)
                    })


                    if (response.status == 200) {
                        TweetsXer.dCount++
                        TweetsXer.updateProgressBar()
                        await TweetsXer.maybePause()

                        if (response.headers.get('x-rate-limit-remaining') != null && response.headers.get('x-rate-limit-remaining') < 1) {
                            console.log('rate limit hit')
                            console.log(response.headers.get('x-rate-limit-remaining'))
                            TweetsXer.ratelimitreset = response.headers.get('x-rate-limit-reset')
                            let sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                            while (sleeptime > 0) {
                                sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                                TweetsXer.updateInfo(`Ratelimited. Waiting ${sleeptime} seconds. ${TweetsXer.dCount} deleted.`)
                                await TweetsXer.sleep(1000)
                            }
                            resolve('deleted and waiting')
                        }
                        else {
                            resolve('deleted')
                        }


                    }
                    else if (response.status == 429) {
                        TweetsXer.tIds.push(TweetsXer.tId)
                        console.log('Received status code 429. Waiting for 1 second before trying again.')
                        await TweetsXer.sleep(1000)
                    }
                    else {
                        console.log(response)
                    }

                } catch (error) {
                    if (error.Name === 'AbortError') {
                        TweetsXer.tIds.push(TweetsXer.tId)
                        console.log('Request timeout.')
                        let sleeptime = 15
                        while (sleeptime > 0) {
                            sleeptime--
                            TweetsXer.updateInfo(`Ratelimited. Waiting ${sleeptime} seconds. ${TweetsXer.dCount} deleted.`)
                            await TweetsXer.sleep(1000)
                        }
                        resolve('error')
                    }
                }
            })
        },

        async deleteTweets() {
            while (this.tIds.length > 0) {
                this.tId = this.tIds.pop()
                if (this.liveLikes && this.spareThreshold > 0) {
                    const likes = await this.getLikeCount(this.tId)
                    if (likes !== null && likes > this.spareThreshold) {
                        this.sparedCount++
                        if (this.total > 0) this.total--
                        console.log(`Spared ${this.tId} (${likes} likes). ${this.sparedCount} spared so far.`)
                        this.updateProgressBar()
                        continue
                    }
                }
                await this.sendRequest(this.baseUrl + this.deleteURL)
            }
            this.tId = ''
            this.updateProgressBar()
        },

        async deleteFavs() {
            this.updateTitle('TweetXer: Deleting Favs')
            // 500 unfavs per 15 Minutes
            // x-rate-limit-remaining
            // x-rate-limit-reset

            while (this.tIds.length > 0) {
                this.tId = this.tIds.pop()
                await this.sendRequest(this.baseUrl + this.unfavURL)
            }
            this.tId = ''
            this.updateTitle('TweetXer')
            this.updateProgressBar()
        },

        async deleteDMs() {
            while (this.tIds.length > 0) {
                this.tId = this.tIds.pop()
                await this.sendRequest(
                    this.baseUrl + this.deleteMessageURL,
                    body = `{\"variables\":{\"messageId\":\"${this.tId}\"},\"requestId\":\""}`
                )
            }
            this.tId = ''
            this.updateProgressBar()
        },

        async deleteConvos() {
            while (this.tIds.length > 0) {
                this.tId = this.tIds.pop()
                url = this.baseUrl + this.deleteConvoURL.replace('USER_ID-CONVERSATION_ID', this.tId)
                let response = await fetch(url, {
                    "headers": {
                        "authorization": TweetsXer.authorization,
                        "content-type": "application/x-www-form-urlencoded",
                        "x-client-transaction-id": TweetsXer.transaction_id,
                        "x-csrf-token": TweetsXer.ct0,
                        "x-twitter-active-user": "yes",
                        "x-twitter-auth-type": "OAuth2Session"
                    },
                    "referrer": `${TweetsXer.baseUrl}/messages`,
                    "body": 'dm_secret_conversations_enabled=false&krs_registration_enabled=true&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_ext_limited_action_results=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&include_ext_views=true&dm_users=false&include_groups=true&include_inbox_timelines=true&include_ext_media_color=true&supports_reactions=true&supports_edit=true&include_conversation_info=true',
                    "method": "POST",
                    "mode": "cors",
                    "credentials": "include",
                    "signal": AbortSignal.timeout(5000)
                })


                if (response.status == 204) {
                    TweetsXer.dCount++
                    TweetsXer.updateProgressBar()
                    await TweetsXer.maybePause()

                    if (response.headers.get('x-rate-limit-remaining') != null && response.headers.get('x-rate-limit-remaining') < 1) {
                        console.log('rate limit hit')
                        console.log(response.headers.get('x-rate-limit-remaining'))
                        TweetsXer.ratelimitreset = response.headers.get('x-rate-limit-reset')
                        let sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                        while (sleeptime > 0) {
                            sleeptime = TweetsXer.ratelimitreset - Math.floor(Date.now() / 1000)
                            TweetsXer.updateInfo(`Ratelimited. Waiting ${sleeptime} seconds. ${TweetsXer.dCount} deleted.`)
                            await TweetsXer.sleep(1000)
                        }
                    }
                    await TweetsXer.sleep(Math.floor(Math.random() * 200)) // send requests slightly slower and with random intervals
                }
                else if (response.status == 429 || response.status == 420) {
                    TweetsXer.tIds.push(TweetsXer.tId)
                    console.log(`Received status code ${response.status}. Waiting before trying again.`)
                    let sleeptime = 60 * 5 // is that enough?
                    while (sleeptime > 0) {
                        sleeptime--
                        TweetsXer.updateInfo(`Ratelimited. Waiting ${sleeptime} seconds. ${TweetsXer.dCount} deleted.`)
                        await TweetsXer.sleep(1000)
                    }

                }
                else {
                    console.log(response)
                }
            }
            this.tId = ''
            this.updateProgressBar()
        },

        async getTweetCount() {
            await waitForElemToExist('header')
            await TweetsXer.sleep(1000)
            if (!document.querySelector('[data-testid="UserName"]')) {
                if (document.querySelector('[aria-label="Back"]')) {
                    await TweetsXer.sleep(200)
                    document.querySelector('[aria-label="Back"]').click()
                    await TweetsXer.sleep(1000)
                }
                else if (document.querySelector('[data-testid="app-bar-back"]')) {
                    document.querySelector('[data-testid="app-bar-back"]').click()
                    await TweetsXer.sleep(1000)
                }

                if (document.querySelector('[data-testid="AppTabBar_Profile_Link"]')) {
                    await TweetsXer.sleep(200)
                    document.querySelector('[data-testid="AppTabBar_Profile_Link"]').click()
                }
                else if (document.querySelector('[data-testid="DashButton_ProfileIcon_Link"]')) {
                    await TweetsXer.sleep(100)
                    document.querySelector('[data-testid="DashButton_ProfileIcon_Link"]').click()
                    await TweetsXer.sleep(1000)
                    document.querySelector('[data-testid="icon"').nextElementSibling.click()
                }

                await waitForElemToExist('[data-testid="UserName"]')
            }
            await TweetsXer.sleep(1000)

            function extractTweetCount(selector) {
                const element = document.querySelector(selector)
                if (!element) return null

                const match = element.textContent.match(/((\d|,|\.|K)+) (\w+)$/)
                if (!match) return null

                return match[1]
                    .replace(/\.(\d+)K/, '$1'.padEnd(4, '0'))
                    .replace('K', '000')
                    .replace(',', '')
                    .replace('.', '')
            }

            try {
                TweetsXer.TweetCount = extractTweetCount('[data-testid="primaryColumn"]>div>div>div')

                if (!TweetsXer.TweetCount) {
                    TweetsXer.TweetCount = extractTweetCount('[data-testid="TopNavBar"]>div>div')
                }

                if (!TweetsXer.TweetCount) {
                    console.log("Wasn't able to find Tweet count on profile. Setting it to 1 million.")
                    TweetsXer.TweetCount = 1000000
                }

            } catch (error) {
                console.log("Wasn't able to find Tweet count on profile. Setting it to 1 million.")
                TweetsXer.TweetCount = 1000000 // prevents Tweets from being skipped because if tweet count of 0

            }
            this.updateInfo('Select your tweet-headers.js from your Twitter Data Export to start the deletion of all your Tweets.')
            console.log(TweetsXer.TweetCount + " Tweets on profile.")
            console.log("You can close the console now to reduce the memory usage.")
            console.log("Reopen the console if there are issues to see if an error shows up.")
        },

        // Read a rendered tweet's like count straight from its UI (no API request).
        likesFromTweetElement(tweetEl) {
            const group = tweetEl.querySelector('[role="group"][aria-label]')
            const label = group ? group.getAttribute('aria-label') : ''
            const match = label.match(/([\d.,]+)\s*(K|M)?\s+like/i)
            if (!match) return 0
            let n = parseFloat(match[1].replace(/,/g, ''))
            if (match[2] === 'K') n *= 1000
            else if (match[2] === 'M') n *= 1000000
            return Math.round(n)
        },

        async slowDelete() {
            //document.getElementById("toggleAdvanced").click()
            TweetsXer.readSettings()
            document.getElementById('start').remove()
            TweetsXer.total = TweetsXer.TweetCount
            TweetsXer.createProgressBar()

            document.querySelectorAll('[data-testid="ScrollSnap-List"] a')[1].click()
            await TweetsXer.sleep(2000)

            let unretweet, confirmURT, caret, menu, confirmation
            let consecutiveErrors = 0
            const maxConsecutiveErrors = 5

            const more = '[data-testid="tweet"] [data-testid="caret"]'
            while (document.querySelectorAll(more).length > 0) {

                // give the Tweets a chance to load; increase/decrease if necessary
                // afaik the limit is 50 requests per minute
                await TweetsXer.sleep(1200)

                // hide recommended profiles and stuff
                document.querySelectorAll('section [data-testid="cellInnerDiv"]>div>div>div').forEach(x => x.remove())
                document.querySelectorAll('section [data-testid="cellInnerDiv"]>div>div>[role="link"]').forEach(x => x.remove())

                // Spare popular tweets by reading the like count from the UI (no API call)
                if (TweetsXer.spareThreshold > 0) {
                    const caretEl = document.querySelector(more)
                    const tweetEl = caretEl ? caretEl.closest('[data-testid="tweet"]') : document.querySelector('[data-testid="tweet"]')
                    if (tweetEl) {
                        const likes = TweetsXer.likesFromTweetElement(tweetEl)
                        if (likes > TweetsXer.spareThreshold) {
                            TweetsXer.sparedCount++
                            if (TweetsXer.total > 0) TweetsXer.total--
                            tweetEl.remove()
                            console.log(`Spared a tweet (${likes} likes). ${TweetsXer.sparedCount} spared so far.`)
                            TweetsXer.updateProgressBar()
                            continue
                        }
                    }
                }

                try {
                    const moreElement = document.querySelector(more)
                    if (moreElement) {
                        moreElement.scrollIntoView({
                            'behavior': 'smooth'
                        })
                    }

                    // if it is a Retweet, unretweet it
                    unretweet = document.querySelector('[data-testid="unretweet"]')
                    if (unretweet) {
                        unretweet.click()
                        confirmURT = await waitForElemToExist('[data-testid="unretweetConfirm"]')
                        confirmURT.click()
                    }

                    // delete Tweet
                    else {
                        caret = await waitForElemToExist(more)
                        caret.click()

                        menu = await waitForElemToExist('[role="menuitem"]')
                        if (menu.textContent.includes('@')) {
                            // don't unfollow people (because their Tweet is the reply tab)
                            caret.click()
                            document.querySelector('[data-testid="tweet"]').remove()
                        } else {
                            menu.click()
                            confirmation = await waitForElemToExist('[data-testid="confirmationSheetConfirm"]')
                            if (confirmation) confirmation.click()
                        }
                    }

                    TweetsXer.dCount++
                    TweetsXer.updateProgressBar()
                    await TweetsXer.maybePause()
                    consecutiveErrors = 0

                    // print to the console how many Tweets already got deleted
                    // Change the 100 to how often you want an update.
                    // 10 for every 10th Tweet, 1 for every Tweet, 100 for every 100th Tweet
                    if (TweetsXer.dCount % 100 == 0) console.log(`${new Date().toUTCString()} Deleted ${TweetsXer.dCount} Tweets`)
                    
                } catch (error) {
                    console.error(`Error deleting tweet: ${error.message}`)
                    consecutiveErrors++
                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        console.log(`${consecutiveErrors} consecutive errors. Stopping.`)
                        break
                    }
                }

            }

            console.log(`Finished. Total deleted: ${TweetsXer.dCount} Tweets. Please reload to confirm.`)
        },

        async unfollow() {
            //document.getElementById("toggleAdvanced").click()
            let unfollowCount = 0
            let next_unfollow, menu

            document.querySelector('[href$="/following"]').click()
            await TweetsXer.sleep(1200)

            const accounts = '[data-testid="UserCell"]'
            while (document.querySelectorAll('[data-testid="UserCell"] [data-testid$="-unfollow"]').length > 0) {
                next_unfollow = document.querySelectorAll(accounts)[0]
                next_unfollow.scrollIntoView({
                    'behavior': 'smooth'
                })

                next_unfollow.querySelector('[data-testid$="-unfollow"]').click()
                menu = await waitForElemToExist('[data-testid="confirmationSheetConfirm"]')
                menu.click()
                next_unfollow.remove()
                unfollowCount++
                if (unfollowCount % 10 == 0) console.log(`${new Date().toUTCString()} Unfollowed ${unfollowCount} accounts`)
                await TweetsXer.sleep(Math.floor(Math.random() * 200))
            }

            console.log('No accounts left. Please reload to confirm.')
        },
        removeTweetXer() {
            document.getElementById('exportUpload').remove()
        }
    }

    const waitForElemToExist = async (selector) => {

        const elem = document.querySelector(selector)
        if (elem) return elem

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const elem = document.querySelector(selector)
                if (elem) {
                    resolve(elem)
                    observer.disconnect()
                }
            })

            observer.observe(document.body, {
                subtree: true,
                childList: true,
            })
        })
    }

    TweetsXer.init()
})()
