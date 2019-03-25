import {settings} from "./settings.js"
import {backend} from "./backend.js"
import {BookmarkTree} from "./tree.js"
import {DEFAULT_SHELF_NAME} from "./db.js";


let tree;


/* show members of an object */
function dir(o, delimiter) {
    var a = [];
    for (let i in o) {
        a.push(i)
    }
    return a.join(delimiter || "\n");
}

function loadShelves() {
    var lastRdf = settings.last_rdf;
    $("#shelfList").html("");
    var saw = false;

    backend.httpGet("/api/list/shelves", (shelves) => {
        $("#shelfList").find("option").remove()
        for (let shelf of shelves) {
            var $opt = $("<option></option>").appendTo($("#shelfList")).html(shelf.name).attr("value", shelf.id);
            if (!saw && typeof lastRdf != "undefined" && shelf.id == lastRdf) {
                saw = true;
                $opt.attr("selected", true);
            }
        }
        switchShelf($("#shelfList").val());
    });
}

function loadAll() {
    loadShelves();
    $("#shelfList").change(function () {
        switchShelf(this.value);
    });
}

function switchShelf(rdf) {
    settings.set('last_rdf', rdf);

    let path = $(`#shelfList option[value="${rdf}"]`).text();

    backend.httpPost("/api/list/nodes", {
            path: path,
            depth: "root+subtree",
            order: "custom"
        },
        nodes => {
            tree.update(nodes);
        });
}

document.addEventListener('contextmenu', function (event) {
    if ($(".dlg-cover:visible").length)
        event.preventDefault()
    return false;
});

window.onload = function () {
    /* i18n */
    document.title = document.title.translate();
    document.body.innerHTML = document.body.innerHTML.translate();

    tree = new BookmarkTree("#treeview");

    var btn = document.getElementById("btnLoad");
    btn.onclick = function () {
        loadShelves();
    };
    var btn = document.getElementById("btnSet");
    btn.onclick = function () {
        browser.tabs.create({
            "url": "options.html"
        });
    }
    var btn = document.getElementById("btnHelp");
    btn.onclick = function () {
        browser.tabs.create({
            "url": "options.html#help"
        });
    }
    var btn = document.getElementById("btnSearch");
    btn.onclick = function () {
        browser.tabs.create({
            "url": "search.html"
        });
    }

    $("#shelf-menu-button").click(() => {
        $("#shelf-menu").toggle()
    });
    $("#shelf-menu-create").click(() => {
        // TODO: i18n
        showDlg("prompt", {caption: "Create shelf", label: "Name"}).then(data => {
            let name;
            if (name = data.title) {
                let existingOption = $(`#shelfList option:contains("${name}")`);
                let selectedOption = $("#shelfList option:selected");

                if (existingOption.length) {
                    selectedOption.removeAttr("selected");
                    existingOption.attr("selected", true);
                }

                if (name !== DEFAULT_SHELF_NAME) {
                    backend.httpPost("/api/create/shelf", {"name": name}, (shelf) => {
                        if (shelf) {
                            selectedOption.removeAttr("selected");
                            $("<option></option>").appendTo($("#shelfList"))
                                .html(shelf.name)
                                .attr("value", shelf.id)
                                .attr("selected", true);

                            switchShelf(shelf.id);
                        }
                    });
                }
            }
        });
    });

    $("#shelf-menu-rename").click(() => {
        let selectedOption = $("#shelfList option:selected");
        let name = selectedOption.text();

        if (name && name !== DEFAULT_SHELF_NAME) {
            // TODO: 118n
            showDlg("prompt", {caption: "Rename", label: "Name", title: name}).then(data => {
                let newName;
                if (newName = data.title) {
                    backend.httpPost("/api/rename/shelf", {"name": name, "new_name": newName}, () => {
                            selectedOption.html(newName);
                            tree.renameRoot(newName)
                        });
                }
            });
        } else if (name === DEFAULT_SHELF_NAME) {
            // TODO: i18n
            alert("{Error}", "The shelf 'default' could not be renamed.")
        }

    });

    $("#shelf-menu-delete").click(() => {
        let selectedOption = $("#shelfList option:selected");
        let name = selectedOption.text();

        if (name === DEFAULT_SHELF_NAME) {
            // TODO: i18n
            alert("{Error}", "The 'default' shelf could not be deleted.")
            return;
        }

        // TODO: 118n
        confirm("{Warning}", "Do you really want to delete '" + name + "'?").then(() => {
            if (name && name !== DEFAULT_SHELF_NAME) {
                backend.httpPost("/api/delete/shelf", {"name": name}, () => {
                        let prevItem = null;
                        let found = false;
                        $("#shelfList option").each((i, o) => {
                            if (found) {
                                return;
                            }

                            if (o.value === selectedOption.val()) {
                                found = true;
                                return;
                            }
                            prevItem = o;
                        });

                        selectedOption.removeAttr("selected");
                        if (prevItem) {
                            $(prevItem).attr("selected", true);
                            switchShelf(prevItem.value);
                        }
                        selectedOption.remove();
                    });
            }
        });
    });


    $(document).on("click", function(e) {
        if (!event.target.matches("#shelf-menu-button"))
            $(".simple-menu").hide();
    });


    loadAll();
};

console.log("==> main.js loaded");
