chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    const action = message.action;

    console.log("Haya extension received:", action);

    if (action === "scrollDown") {
        window.scrollBy({ top: 600, behavior: "smooth" });
    }

    if (action === "scrollUp") {
        window.scrollBy({ top: -600, behavior: "smooth" });
    }

    if (action === "goBack") {
        history.back();
    }

    if (action === "refreshPage") {
        location.reload();
    }

    if (action === "pauseVideo") {
        const video = document.querySelector("video");
        if (video) video.pause();
    }

    if (action === "playVideo") {
        const video = document.querySelector("video");
        if (video) video.play();
    }

});