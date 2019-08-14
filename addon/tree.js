import {backend} from "./backend.js"

import {
    ENDPOINT_TYPES,
    NODE_TYPE_ARCHIVE,
    NODE_TYPE_BOOKMARK,
    NODE_TYPE_GROUP,
    NODE_TYPE_SHELF,
    NODE_TYPE_SEPARATOR,
    NODE_TYPE_NOTES,
    TODO_STATE_CANCELLED,
    TODO_STATE_DONE,
    TODO_STATE_POSTPONED,
    TODO_STATE_TODO,
    TODO_STATE_WAITING,
    EVERYTHING, TODO_NAMES, TODO_NAME, FIREFOX_SHELF_NAME, FIREFOX_SHELF_ID,
    isSpecialShelf, isContainer, isEndpoint
} from "./db.js"

import {showDlg, alert, confirm} from "./dialog.js"
import {settings} from "./settings.js";
import {GetPocket} from "./lib/pocket.js";
import {dropbox} from "./lib/dropbox.js";
import {showNotification} from "./utils.js";

export const TREE_STATE_PREFIX = "tree-state-";

class BookmarkTree {
    constructor(element, inline=false) {
        this._element = element;
        this._inline = inline;

        let plugins = ["wholerow", "types", "state"];

        if (!inline) {
            plugins = plugins.concat(["contextmenu", "dnd"]);
        }

        $(element).jstree({
            plugins: plugins,
            core: {
                worker: false,
                animation: 0,
                multiple: !inline,
                check_callback: BookmarkTree.checkOperation,
                themes: {
                    name: "default",
                    dots: false,
                    icons: true,
                },
            },
            contextmenu: {
                show_at_node: false,
                items: (node) => {return this.contextMenu(node)}
            },
            types: {
                "#": {
                    "valid_children": [NODE_TYPE_SHELF]
                },
                [NODE_TYPE_SHELF]: {
                    "valid_children": [NODE_TYPE_GROUP, ...ENDPOINT_TYPES, NODE_TYPE_SEPARATOR]
                },
                [NODE_TYPE_GROUP]: {
                    "valid_children": [NODE_TYPE_GROUP, ...ENDPOINT_TYPES, NODE_TYPE_SEPARATOR]
                },
                [NODE_TYPE_BOOKMARK]: {
                    "valid_children": []
                },
                [NODE_TYPE_ARCHIVE]: {
                    "valid_children": []
                },
                [NODE_TYPE_SEPARATOR]: {
                    "valid_children": []
                }
            },
            state: {
                key: inline? TREE_STATE_PREFIX + EVERYTHING: undefined
            },
            dnd: {
                inside_pos: "last"
            }
        }).on("move_node.jstree", BookmarkTree.moveNode);

        this._jstree = $(element).jstree(true);

        $(document).on("mousedown", ".jstree-node", e => this.handleMouseClick(e));
        $(document).on("click", ".jstree-anchor", e => this.handleMouseClick(e));
        // $(document).on("auxclick", ".jstree-anchor", e => e.preventDefault());
    }

    handleMouseClick(e) {
        if (e.type === "click" && e.target._mousedown_fired) {
            e.target._mousedown_fired = false;
            return;
        }

        if (e.button === undefined || e.button === 0 || e.button === 1) {
            e.preventDefault();

            if (e.type === "mousedown")
                e.target._mousedown_fired = true;

            let element = e.target;
            while (element && !$(element).hasClass("jstree-node")) {
                element = element.parentNode;
            }

            if (e.type === "mousedown" && e.button === 0 && $(e.target).hasClass("jstree-wholerow")) {
                let anchor = $(element).find(".jstree-anchor");
                if (anchor.length)
                    anchor [0]._mousedown_fired = true;
            }
            if (e.type === "mousedown" && e.button === 1 && $(e.target).hasClass("jstree-anchor")) {
                let anchor = $(element).find(".jstree-anchor");
                if (anchor.length)
                    anchor[0]._mousedown_fired = false;
            }

            let clickable = element.getAttribute("data-clickable");
            let id = element.getAttribute("data-id");
            let external = element.getAttribute("data-external");

            if (clickable && !e.ctrlKey && !e.shiftKey) {
                switch (external) {
                    case "browser":
                        let node = this._jstree.get_node(id);
                        browser.runtime.sendMessage({type: "BROWSE_NODE", node: node.original});
                        break;
                    default:
                        backend.getNode(parseInt(id)).then(node => {
                            if (node) {
                                //console.log(node);
                                browser.runtime.sendMessage({type: "BROWSE_NODE", node: node});
                            }
                        });
                }
            }
            return false;
        }
    }

    traverse(root, visitor) {
        let _tree = this._jstree;
        function doTraverse(root) {
            if (!settings.show_firefox_toolbar() && root.original && root.original.external_id === "toolbar_____"
                || !settings.show_firefox_mobile() && root.original && root.original.external_id === "mobile______")
                return;

            visitor(root);
            if (root.children)
                for (let id of root.children) {
                    let node = _tree.get_node(id);
                    doTraverse(node);
                }
        }

        doTraverse(root);
    }

    // static _todoColor(todo_state) {
    //     switch (todo_state) {
    //         case TODO_STATE_TODO:
    //             return "#fc6dac";
    //         case TODO_STATE_WAITING:
    //             return"#ff8a00";
    //         case TODO_STATE_POSTPONED:
    //             return "#00b7ee";
    //         case TODO_STATE_CANCELLED:
    //             return "#ff4d26";
    //         case TODO_STATE_DONE:
    //             return "#00b60e";
    //     }
    //     return "";
    // }

    static _styleTODO(node) {
        if (node.todo_state)
            return " todo-state-" + (node._overdue
                ? "overdue"
                : TODO_NAMES[node.todo_state].toLowerCase());

        return "";
    }

    static _formatTODO(node) {
        let text = "<div><span class='todo-path'>";

        for (let i = 0; i < node._path.length; ++i) {
            text += node._path[i];

            if (i !== node._path.length - 1)
                text += " &#187; "
        }

        if (node.todo_date)
            text += " | " + "<span class='" + BookmarkTree._styleTODO(node) + "'>" + node.todo_date + "</span>";

        if (node.details)
            text += " | " + "<span class='todo-details'>" + node.details + "</span>";

        text += "</span><br/>";
        text += "<span class='todo-text'>" + node.name + "</span></div>";

        return text;
    }

    static toJsTreeNode(n) {
        n.text = n.name;

        n.parent = n.parent_id;
        if (!n.parent)
            n.parent = "#";

        if (n.type == NODE_TYPE_SHELF && n.external === FIREFOX_SHELF_NAME) {
            n.li_attr = {"class": "browser-logo"};
            if (!settings.show_firefox_bookmarks()) {
                n.state = {hidden: true};
            }
            if (settings.capitalize_builtin_shelf_names())
                n.text = n.name.capitalizeFirstLetter();
        }
        else if (n.type == NODE_TYPE_SHELF) {
            if (n.name && isSpecialShelf(n.name) && settings.capitalize_builtin_shelf_names())
                n.text = n.name.capitalizeFirstLetter();
            n.icon = "/icons/shelf.svg";
            n.li_attr = {"class": "scrapyard-shelf"}
        }
        else if (n.type == NODE_TYPE_GROUP) {
            if (n.external === FIREFOX_SHELF_NAME && n.external_id === "menu________") {
                n.icon = "/icons/bookmarksMenu.svg";
                n.li_attr = {"class": "browser-bookmark-menu"};
            }
            else if (n.external === FIREFOX_SHELF_NAME && n.external_id === "unfiled_____") {
                n.icon = "/icons/unfiledBookmarks.svg";
                n.li_attr = {"class": "browser-unfiled-bookmarks"};
            }
            else if (n.external === FIREFOX_SHELF_NAME && n.external_id === "toolbar_____") {
                n.icon = "/icons/bookmarksToolbar.svg";
                n.li_attr = {"class": "browser-bookmark-toolbar"};
                if (!settings.show_firefox_toolbar())
                    n.state = {hidden: true};
            }
            else if (n.external === FIREFOX_SHELF_NAME && n.external_id === "mobile______") {
                if (!settings.show_firefox_mobile())
                    n.state = {hidden: true};
            }
            else {
                n.icon = "/icons/group.svg";
                n.li_attr = {
                    "class": "scrapyard-group",
                }
            }
        }
        else if (n.type == NODE_TYPE_SEPARATOR) {
            n.text = "─".repeat(40);
            n.a_attr = {
                "class": "separator-node"
            };
        }
        else if (n.type != NODE_TYPE_SHELF) {
            let uri = "";
            if (n.uri)
                uri = false //n.uri.length > 60
                    ? "\x0A" + n.uri.substring(0, 60) + "..."
                    : ("\x0A" + n.uri);

            n.li_attr = {
                "class": "show_tooltip",
                "title": `${n.text}${uri}`,
                "data-id": n.id,
                "data-clickable": "true",
                "data-external": n.browser? "browser": "false"
            };

            if (n.type == NODE_TYPE_ARCHIVE)
                n.li_attr.class += " archive-node";

            n.a_attr = {
                "class": n.has_notes? "has-notes": ""
            };

            if (n.todo_state) {
                n.a_attr.class += BookmarkTree._styleTODO(n);

                if (n._extended_todo) {
                    n.li_attr.class += " extended-todo";
                    n.text = BookmarkTree._formatTODO(n);
                }
            }

            if (n.type == NODE_TYPE_NOTES) {
                n.icon = "/icons/notes.svg";
                n.li_attr.class += " scrapyard-notes";
            }

             //n.fallbackIcon = "var(--themed-globe-icon)";

            if (!n.icon) {
                n.icon = "var(--themed-globe-icon)";
                n.a_attr.class += " generic-icon";
            }
        }

        n.data = {};
        n.data.uuid = n.uuid;

        return n;
    }

    set data(nodes) {
        this._jstree.settings.core.data = nodes;
    }

    get data() {
        return this._jstree.settings.core.data
    }

    get stateKey() {
        return this._jstree.settings.state.key;
    }

    set stateKey(key) {
        this._jstree.settings.state.key = key;
    }

    get selected() {
        return this._jstree.get_node(this._jstree.get_selected())
    }

    update(nodes, everything = false) {
        nodes.forEach(BookmarkTree.toJsTreeNode);
        this.data = nodes;

        let state;

        if (this._inline || everything) {
            this._everything = true;
            this._jstree.settings.state.key = TREE_STATE_PREFIX + EVERYTHING;
            state = JSON.parse(localStorage.getItem(TREE_STATE_PREFIX + EVERYTHING));
        }
        else {
            this._everything = false;
            let shelves = this.data.filter(n => n.type == NODE_TYPE_SHELF);

            this._jstree.settings.state.key = TREE_STATE_PREFIX + shelves[0].name;
            state = JSON.parse(localStorage.getItem(TREE_STATE_PREFIX + shelves[0].name));
        }

        this._jstree.refresh(true, () => state? state.state: null);
    }

    list(nodes, state_key) {
        if (state_key)
            this.stateKey = TREE_STATE_PREFIX + state_key;

        nodes.forEach(BookmarkTree.toJsTreeNode);
        nodes.forEach(n => n.parent = "#");

        this.data = nodes;
        this._jstree.refresh(true);
    }

    renameRoot(name) {
        let root_node = this._jstree.get_node(this.data.find(n => n.type == NODE_TYPE_SHELF));
        this._jstree.rename_node(root_node, name);
    }

    openRoot() {
        let root_node = this._jstree.get_node(this.data.find(n => n.type == NODE_TYPE_SHELF));
        this._jstree.open_node(root_node);
        this._jstree.deselect_all(true);
    }

    static checkOperation(operation, node, parent, position, more) {
        // disable dnd copy
        if (operation === "copy_node") {
            return false;
        } else if (operation === "move_node") {
            if (more.ref && more.ref.id == FIREFOX_SHELF_ID
                    || parent.id == FIREFOX_SHELF_ID || node.parent == FIREFOX_SHELF_ID)
                return false;
        }
        return true;
    }

    static moveNode(_, data) {
        let tree = $(this).jstree(true);
        let parent = tree.get_node(data.parent);

        if (data.parent != data.old_parent) {
            let node = tree.get_node(data.node);

            backend.moveNodes([node.original.id], parent.original.id).then(new_nodes => {
                BookmarkTree.reorderNodes(tree, parent);
            });
        }
        else
            BookmarkTree.reorderNodes(tree, parent);
    }

    static reorderNodes(tree, parent) {
        let siblings = parent.children.map(c => tree.get_node(c));

        let positions = [];
        for (let i = 0; i < siblings.length; ++i) {
            let node = {};
            node.id = siblings[i].original.id;
            node.external = siblings[i].original.external;
            node.external_id = siblings[i].original.external_id;
            node.pos = i + 1;
            positions.push(node);
        }

        backend.reorderNodes(positions);
    }

    /* context menu listener */
    contextMenu(ctx_node) { // TODO: i18n
        let self = this;
        let tree = this._jstree;
        let selected_nodes = tree.get_selected(true) || [];
        let multiselect = selected_nodes.length > 1;
        let all_nodes = this.data;
        let ctx_node_data = ctx_node.original;

        function setTODOState(state) {
            let selected_ids = selected_nodes.map(n => n.original.type === NODE_TYPE_GROUP
                                                            || n.original.type === NODE_TYPE_SHELF
                                                        ? n.children
                                                        : n.original.id);
            let todo_states = [];
            let marked_nodes = selected_ids.flat().map(id => tree.get_node(id));

            selected_ids = marked_nodes.filter(n => isEndpoint(n.original))
                .map(n => parseInt(n.id));

            selected_ids.forEach(n => todo_states.push({id: n, todo_state: state}));

            backend.setTODOState(todo_states).then(() => {
                selected_ids.forEach(id => {

                    let node = tree.get_node(id);
                    node.original.todo_state = state;
                    node.a_attr.class = node.a_attr.class.replace(/todo-state-[a-zA-Z]+/g, "");
                    node.a_attr.class += BookmarkTree._styleTODO(node.original);
                    node.text = node.text.replace(/todo-state-[a-zA-Z]+/g, node.a_attr.class);
                    tree.redraw_node(node, true, false, true);
                });
            });
        }

        let items = {
            openItem: {
                label: "Open",
                action: function () {
                    for (let n of selected_nodes) {
                        browser.runtime.sendMessage({type: "BROWSE_NODE", node: n.original});
                    }
                }
            },
            openAllItem: {
                label: "Open All",
                action: function () {
                    let children = all_nodes.filter(n => ctx_node.children.some(id => id == n.id)
                            && isEndpoint(n));
                    children.forEach(c => browser.runtime.sendMessage({type: "BROWSE_NODE", node: c}))
                }
            },
            sortItem: {
                label: "Sort by Name",
                action: function () {
                    let children = ctx_node.children.map(c => tree.get_node(c));
                    children.sort((a, b) => a.text.localeCompare(b.text));
                    ctx_node.children = children.map(c => c.id);

                    tree.redraw_node(ctx_node, true, false, true);
                    BookmarkTree.reorderNodes(tree, ctx_node);
                }
            },
            openOriginalItem: {
                label: "Open Original URL",
                action: function () {
                    browser.tabs.create({
                        "url": ctx_node_data.uri
                    });
                }
            },
            copyLinkItem: {
                label: "Copy Link",
                action: function () {
                    navigator.clipboard.writeText(ctx_node_data.uri);
                }
            },
            newFolderItem: {
                label: "New Folder",
                action: function () {
                    backend.createGroup(ctx_node_data.id, "New Folder").then(group => {
                        BookmarkTree.toJsTreeNode(group);
                        tree.deselect_all(true);

                        let group_node = tree.get_node(tree.create_node(ctx_node, group));
                        tree.select_node(group_node);

                        BookmarkTree.reorderNodes(tree, ctx_node);

                        tree.edit(group_node, null, (node, success, cancelled) => {
                            if (success && !cancelled)
                                backend.renameGroup(group.id, node.text).then(group => {
                                    group_node.original.name = group_node.original.text = group.name;
                                    tree.rename_node(group_node, group.name);
                                });
                        });
                    });
                }
            },
            newSeparatorItem: {
                label: "New Separator",
                action: function () {
                    let parent = tree.get_node(ctx_node.parent);

                    backend.addSeparator(parent.original.id).then(separator => {
                            let position = $.inArray(ctx_node.id, parent.children);
                            tree.create_node(parent, BookmarkTree.toJsTreeNode(separator), position + 1);
                            BookmarkTree.reorderNodes(tree, parent);
                        });
                }
            },
            newNotesItem: {
                label: "New Notes",
                action: () => {
                    backend.addNotesNode(ctx_node_data.id, "New Notes").then(notes => {
                        BookmarkTree.toJsTreeNode(notes);
                        this.data.push(notes);
                        tree.deselect_all(true);

                        let notes_node = tree.get_node(tree.create_node(ctx_node, notes));
                        tree.select_node(notes_node);

                        BookmarkTree.reorderNodes(tree, ctx_node);

                        tree.edit(notes_node, null, (node, success, cancelled) => {
                            if (success && !cancelled)
                                backend.updateNode({id: notes.id, name: node.text}).then(() => {
                                    notes_node.original.name = node.text;
                                });
                        });
                    });
                }
            },
            shareItem: {
                separator_before: true,
                label: "Share",
                submenu: {
                    pocketItem: {
                        label: "Pocket",
                        icon: "icons/pocket.svg",
                        action: async function () {
                            const auth_handler = auth_url => new Promise(async (resolve, reject) => {
                                let pocket_tab = await browser.tabs.create({url: auth_url});
                                let listener = async (id, changed, tab) => {
                                    if (id === pocket_tab.id) {
                                        if (changed.url && !changed.url.includes("getpocket.com")) {
                                            await browser.tabs.onUpdated.removeListener(listener);
                                            browser.tabs.remove(pocket_tab.id);
                                            resolve();
                                        }
                                    }
                                };
                                browser.tabs.onUpdated.addListener(listener);
                            });

                            let pocket = new GetPocket({consumer_key: "87251-b8d5db3009affab6297bc799",
                                                        access_token: settings.pocket_access_token(),
                                                        redirect_uri: "https://gchristensen.github.io/scrapyard/",
                                                        auth_handler: auth_handler,
                                                        persist_token: token => settings.pocket_access_token(token)});

                            if (selected_nodes) {
                                let actions = selected_nodes.map(n => ({
                                    action: "add",
                                    title: n.original.name,
                                    url: n.original.uri,
                                    tags: n.original.tags
                                }));
                                await pocket.modify(actions).catch(e => console.log(e));

                                showNotification(`Successfully added item${selected_nodes.length > 1? "s": ""} to Pocket.`)
                            }
                        }
                    },
                    dropboxItem: {
                        label: "Dropbox",
                        icon: "icons/dropbox.png",
                        action: async function () {
                            const auth_handler = auth_url => new Promise(async (resolve, reject) => {
                                let dropbox_tab = await browser.tabs.create({url: auth_url});
                                let listener = async (id, changed, tab) => {
                                    if (id === dropbox_tab.id) {
                                        if (changed.url && !changed.url.includes("dropbox.com")) {
                                            await browser.tabs.onUpdated.removeListener(listener);
                                            browser.tabs.remove(dropbox_tab.id);
                                            resolve(changed.url);
                                        }
                                    }
                                };
                                browser.tabs.onUpdated.addListener(listener);
                            });
                            const token_store = function (key, val) {
                                return arguments.length > 1
                                    ? settings[`dropbox_${key}`](val)
                                    : settings[`dropbox_${key}`]();
                            };
                            const authenticate = async () =>
                                await dropbox.authenticate({client_id: "986piotqb77feik",
                                                                    redirect_uri: "https://gchristensen.github.io/scrapyard/",
                                                                    auth_handler: auth_handler});
                            const upload = async (filename, content, reentry) => {
                                await authenticate();
                                return dropbox('files/upload', {
                                        "path": "/" + filename.replace(/[\\\/:*?"<>|\[\]()^#%&!@:+={}'~]/g, "_"),
                                        "mode": "add",
                                        "autorename": true,
                                        "mute": false,
                                        "strict_conflict": false
                                    }, content).then(o => console.log(o))
                                    .catch(xhr => {
                                        if (!reentry && xhr.status >= 400) {
                                            token_store("__dbat", "");
                                            return upload(filename, content, true);
                                        }
                                    })

                            };

                            dropbox.setTokenStore(token_store);

                            for (let node of selected_nodes) {
                                let filename, content;

                                if (node.original.type === NODE_TYPE_ARCHIVE) {
                                    let blob = await backend.fetchBlob(node.original.id);
                                    if (blob) {
                                        if (blob.byte_length) {
                                            let byteArray = new Uint8Array(blob.byte_length);
                                            for (let i = 0; i < blob.data.length; ++i)
                                                byteArray[i] = blob.data.charCodeAt(i);

                                            blob.data = byteArray;
                                        }

                                        let type = blob.type? blob.type: "text/html";
                                        filename = node.original.name + (type.endsWith("pdf")? ".pdf": ".html");
                                        content = new Blob([blob.data],{type: type});
                                    }
                                }
                                else if (node.original.type === NODE_TYPE_BOOKMARK) {
                                    filename = node.original.name + ".url";
                                    content = "[InternetShortcut]\nURL=" + node.original.uri;
                                }
                                else if (node.original.type === NODE_TYPE_NOTES) {
                                    let notes = await backend.fetchNotes(node.original.id);

                                    if (notes) {
                                        filename = node.original.name + ".org";
                                        content = notes.content;
                                    }
                                }

                                if (filename && content) {
                                    await upload(filename, content);
                                    showNotification(`Successfully added item${selected_nodes.length > 1? "s": ""} to Dropbox.`)
                                }
                            }
                        }
                    }
                }
            },
            cutItem: {
                separator_before: true,
                label: "Cut",
                action: function () {
                    tree.cut(selected_nodes);
                }
            },
            copyItem: {
                label: "Copy",
                action: function () {
                    tree.copy(selected_nodes);
                }
            },
            pasteItem: {
                label: "Paste",
                separator_before: ctx_node_data.type === NODE_TYPE_SHELF || ctx_node_data.parent_id == FIREFOX_SHELF_ID,
                _disabled: !(tree.can_paste() && isContainer(ctx_node_data)),
                action: function () {
                    let buffer = tree.get_buffer();
                    let selection =  Array.isArray(buffer.node)
                        ? buffer.node.map(n => n.original.id)
                        : [buffer.node.original.id];

                    if (self.startProcessingIndication)
                        self.startProcessingIndication();

                    (buffer.mode == "copy_node"
                        ? backend.copyNodes(selection, ctx_node_data.id)
                        : backend.moveNodes(selection, ctx_node_data.id))
                        .then(new_nodes => {
                            switch (buffer.mode) {
                                case "copy_node":
                                    break;
                                case "move_node":
                                    for (let s of selection)
                                        tree.delete_node(s);
                                    break;
                            }

                            for (let n of new_nodes) {
                                let parent = tree.get_node(n.parent_id);
                                tree.create_node(parent, BookmarkTree.toJsTreeNode(n), "last");

                                if (!all_nodes.some(d => d.id == n.id)) {
                                    all_nodes.push(n);
                                }
                            }

                            BookmarkTree.reorderNodes(tree, ctx_node);

                            tree.clear_buffer();

                            if (self.stopProcessingIndication)
                                self.stopProcessingIndication();
                        }).catch(() => {
                            if (self.stopProcessingIndication)
                                self.stopProcessingIndication();
                        });
                }
            },
            viewNotesItem: {
                separator_before: true,
                label: "Open Notes",
                action: () => {
                    browser.runtime.sendMessage({type: "BROWSE_NOTES", node: ctx_node_data});
                }
            },
            todoItem: {
                separator_before: true,
                label: "TODO",
                submenu: {
                    todoItem: {
                        label: "TODO",
                        icon: "icons/todo.svg",
                        action: function () {
                            setTODOState(TODO_STATE_TODO);
                        }
                    },
                    waitingItem: {
                        label: "WAITING",
                        icon: "icons/waiting.svg",
                        action: function () {
                            setTODOState(TODO_STATE_WAITING);
                        }
                    },
                    postponedItem: {
                        label: "POSTPONED",
                        icon: "icons/postponed.svg",
                        action: function () {
                            setTODOState(TODO_STATE_POSTPONED);
                        }
                    },
                    cancelledItem: {
                        label: "CANCELLED",
                        icon: "icons/cancelled.svg",
                        action: function () {
                            setTODOState(TODO_STATE_CANCELLED);
                        }
                    },
                    doneItem: {
                        label: "DONE",
                        icon: "icons/done.svg",
                        action: function () {
                            setTODOState(TODO_STATE_DONE);
                        }
                    },
                    clearItem: {
                        separator_before: true,
                        label: "Clear",
                        action: function () {
                            setTODOState(null);
                        }
                    }
                }
            },
            deleteItem: {
                separator_before: true,
                label: "Delete",
                action: () => {
                    if (ctx_node_data.type === NODE_TYPE_SHELF) {
                        if (this.onDeleteShelf)
                            this.onDeleteShelf(ctx_node_data);
                    }
                    else {
                        confirm("{Warning}", "{ConfirmDeleteItem}").then(() => {
                            let selected_ids = selected_nodes.map(n => n.original.id);

                            backend.deleteNodes(selected_ids).then(() => {
                                tree.delete_node(selected_nodes);
                            });
                        });
                    }
                }
            },
            propertiesItem: {
                separator_before: true,
                label: "Properties...",
                action: function () {
                    if (isEndpoint(ctx_node.original)) {
                        showDlg("properties", ctx_node_data).then(data => {
                            let live_data = all_nodes.find(n => n.id == ctx_node_data.id);
                            Object.assign(live_data, data);

                            backend.updateBookmark(Object.assign(ctx_node_data, data)).then(() => {
                                if (!ctx_node_data._extended_todo) {
                                    tree.rename_node(ctx_node, ctx_node_data.name);
                                }
                                else {
                                    tree.rename_node(ctx_node, BookmarkTree._formatTODO(ctx_node_data));
                                }
                                tree.redraw_node(ctx_node, true, false, true);
                            });
                        });
                    }
                }
            },
            renameItem: {
                label: "Rename",
                action: () => {
                    switch (ctx_node.original.type) {
                        case NODE_TYPE_SHELF:
                            if (this.onRenameShelf)
                                this.onRenameShelf(ctx_node_data);
                            break;
                        case NODE_TYPE_GROUP:
                            tree.edit(ctx_node, null, (node, success, cancelled) => {
                                if (success && !cancelled)
                                    backend.renameGroup(ctx_node_data.id, node.text).then(group => {
                                        ctx_node_data.name = ctx_node_data.text = group.name;
                                        tree.rename_node(ctx_node, group.name);
                                    });
                            });
                            break;
                    }
                }
            }
        };


        switch (ctx_node.original.type) {
            case NODE_TYPE_SHELF:
                delete items.cutItem;
                delete items.copyItem;
                if (ctx_node.original.id == FIREFOX_SHELF_ID) {
                    items = {};
                }
            case NODE_TYPE_GROUP:
                //delete items.newSeparatorItem;
                delete items.openItem;
                delete items.openOriginalItem;
                delete items.propertiesItem;
                delete items.copyLinkItem;
                delete items.shareItem;
                if (ctx_node.original.external)
                    delete items.newNotesItem;
                if (ctx_node.original.parent_id == FIREFOX_SHELF_ID) {
                    delete items.cutItem;
                    delete items.copyItem;
                    delete items.renameItem;
                    delete items.deleteItem;
                }
                break;
            case NODE_TYPE_NOTES:
                delete items.shareItem.submenu.pocketItem;
            case NODE_TYPE_BOOKMARK:
                delete items.openOriginalItem;
            case NODE_TYPE_ARCHIVE:
                delete items.newNotesItem;
                delete items.openAllItem;
                delete items.sortItem;
                delete items.newFolderItem;
                delete items.renameItem;
                break;
        }

        if (ctx_node.original.type === NODE_TYPE_SEPARATOR) {
            for (let k in items)
                if (!["deleteItem"].find(s => s === k))
                    delete items[k];
        }

        if (!isEndpoint(ctx_node.original)) {
            delete items.viewNotesItem;
        }

        if (ctx_node.original._extended_todo) {
            delete items.newSeparatorItem;
        }

        if (multiselect) {
            items["sortItem"] && (items["sortItem"]._disabled = true);
            items["renameItem"] && (items["renameItem"]._disabled = true);
            items["openAllItem"] && (items["openAllItem"]._disabled = true);
            items["copyLinkItem"] && (items["copyLinkItem"]._disabled = true);
            items["newFolderItem"] && (items["newFolderItem"]._disabled = true);
            items["viewNotesItem"] && (items["viewNotesItem"]._disabled = true);
            items["propertiesItem"] && (items["propertiesItem"]._disabled = true);
            items["newSeparatorItem"] && (items["newSeparatorItem"]._disabled = true);
            items["openOriginalItem"] && (items["openOriginalItem"]._disabled = true);
        }

        return items;
    }
}


export {BookmarkTree};
