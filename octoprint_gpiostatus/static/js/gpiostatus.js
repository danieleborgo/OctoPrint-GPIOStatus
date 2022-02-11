/*
 * Copyright (C) 2022 Daniele Borgo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

GPIOSTATUS_ENABLE_CLIENT_DEBUG_LOGS = true;

$(function () {
    function GPIOStatusViewModel(parameters) {
        let self = this;
        self.settingsViewModel = parameters[0];

        self.gpiostatus = undefined;
        self.onBeforeBinding = function () {
            self.gpiostatus = self.settingsViewModel.settings.plugins.gpiostatus;
        };


        /* ********* CONSTANTS ********* */

        self.const = {
            MAX_NOTE_LENGTH: 30,

            // Used to sort arrays
            FIRST_GREATER: 1,
            SECOND_GREATER: -1,
            EQUAL: 0,

            // Const times in ms
            POST_REQUEST_TIMEOUT: 20_000,
            WAIT_TIME_BEFORE_SAVING: 1_500,
            CONTROLS_DISABLED_TIME: 1_000,
            NOTE_SAVE_TIMEOUT: 1_500
        };


        /* ********* WEB INTERFACE COMMUNICATION ********* */

        // Manages the last update time label
        self.last_time = {
            label: ko.observable("-"),

            set() {
                let date = new Date($.now());
                self.last_time.label(date.toLocaleDateString() + " " + date.toLocaleTimeString());
            },

            show(string) {
                this.label(string);
            },

            setDefault(text) {
                self.last_time.show(text);
            }
        };

        // This object manages local checks and their logic
        self.local_checks = {
            // Elements decoupling in view from the server ones avoid lags when automatic saving is used
            compact_view: ko.observable(),
            hide_special_pins: ko.observable(),
            order_by_name: ko.observable(),
            hide_physical: ko.observable(),
            show_notes: ko.observable(),
            hide_images: ko.observable(),

            // To handle compact_view checkbox
            compactViewUpdated() {
                if (self.local_checks.compact_view()) {
                    self.local_checks.hide_special_pins(false);
                    self.local_checks.order_by_name(false);
                    self.local_checks.show_notes(false);
                }
                self.local_checks.updateAfterCheckChanged();
                return true;
            },

            // To handle hide_special_pins checkbox
            hideSpecialPinsUpdated() {
                self.local_checks.genericNoCompactCheckUpdated(self.local_checks.hide_special_pins);
                return true;
            },

            // To handle order_by_name checkbox
            orderByNameUpdated() {
                self.local_checks.genericNoCompactCheckUpdated(self.local_checks.order_by_name);
                return true;
            },

            // To handle hide_physical checkbox
            hidePhysicalUpdated() {
                self.local_checks.updateAfterCheckChanged();
                return true;
            },

            // To handle show_notes checkbox
            showNotesUpdated() {
                self.local_checks.genericNoCompactCheckUpdated(self.local_checks.show_notes);
                return true;
            },

            hideImagesUpdated() {
                self.local_checks.updateAfterCheckChanged();
                return true;
            },

            // To handle a checkbox incompatible with the compressed representation
            genericNoCompactCheckUpdated(check) {
                if (check())
                    self.local_checks.compact_view(false);
                self.local_checks.updateAfterCheckChanged();
            },

            // To decide if, after a checkbox state change, a complete refresh is needed
            updateAfterCheckChanged(update_mandatory = true) {
                // Reload data from the server
                if (self.gpiostatus.reload_on_check_change()) {
                    self.refresh();
                    return;
                }

                // Reload data from a backup
                self.backup.restore();
            },

            activateAutomaticLocalToServerSaving() {
                self.local_checks.activate(self.local_checks.compact_view, self.gpiostatus.compact_view);
                self.local_checks.activate(self.local_checks.hide_special_pins, self.gpiostatus.hide_special_pins);
                self.local_checks.activate(self.local_checks.order_by_name, self.gpiostatus.order_by_name);
                self.local_checks.activate(self.local_checks.hide_physical, self.gpiostatus.hide_physical);
                self.local_checks.activate(self.local_checks.show_notes, self.gpiostatus.show_notes);
                self.local_checks.activate(self.local_checks.hide_images, self.gpiostatus.hide_images);
            },

            activate(local, remote) {
                local.subscribe((new_value) => {
                    remote(new_value);
                    self.settings_saver.save();
                });
                local(remote());
            }
        };

        // To manage the automatic saving and to try to compact a saving when multiple elements are modified
        self.settings_saver = {
            timeout: null,
            saving: ko.observable(false),

            save() {
                if (self.timeout != null)
                    clearTimeout(self.timeout);

                this.saving(true);
                self.timeout = setTimeout(function () {
                    self.timeout = null;
                    self.settings_saver.saving(false);
                    self.settingsViewModel.saveData();
                    self.log("GPIOStatus: successfully saved data");
                }, self.const.WAIT_TIME_BEFORE_SAVING);
            }
        };

        // To handle the loading checkboxes configuration
        self.load_screen = {
            active: ko.observable(false),
            timeout: null,

            show() {
                if (this.timeout != null) {
                    clearTimeout(this.timeout);
                    this.timeout = null;
                }
                this.active(true);
            },

            hide() {
                // It is not removed immediately but after the given time
                this.timeout = setTimeout(function () {
                    self.load_screen.active(false);
                    self.load_screen.timeout = null;
                }, self.const.CONTROLS_DISABLED_TIME);
            }
        };


        /* ********* GPIO STATUS CLIENT CORE ********* */

        // This performs a complete GPIOStatus screen refresh, requiring data from the server
        self.refresh = function () {
            self.load_screen.show();
            self.setTextAllOutput("Updating...");

            $.ajax({
                url: API_BASEURL + "plugin/gpiostatus",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify({
                    command: "gpio_status",
                    hw: self.loader.first_time_execution,
                    funcs: self.loader.first_time_execution
                }),
                timeout: self.const.POST_REQUEST_TIMEOUT
            }).done(function (data) {

                self.log("GPIO status data arrived");
                if (data.commands.raspi_config && data.commands.raspi_gpio) {
                    self.backup.backup(data);
                    self.loader.parseRawData(data);
                    return;
                }

                // The server doesn't have the necessary commands
                self.backup.deleteBackup();
                self.notification.set_commands_unavailable(data.commands);

            }).fail(function () {

                self.log("Error");
                self.backup.deleteBackup();
                self.setTextAllOutput("Failed to retrieve");

            }).always(function () {

                self.last_time.set();
                self.load_screen.hide();

            });
        };

        self.backup = {
            data: null,

            // This function restores a backup if it finds it, otherwise refreshes
            restore() {
                self.load_screen.show();
                if (this.data != null)
                    self.loader.parseRawData(this.data);
                else
                    self.refresh();
                self.load_screen.hide();
            },

            backup(data) {
                this.data = {
                    "status": JSON.parse(JSON.stringify(data.status)),
                    "services": JSON.parse(JSON.stringify(data.services))
                    // hardware is updated once
                };
            },

            deleteBackup() {
                this.data = null;
            }
        }

        self.loader = {
            first_time_execution: true,

            // Given a GPIO Status data, from the server or a backup, this function fills all the fields
            parseRawData(data) {
                this.parseGPIOStatusAndFuncs(data.status);
                self.services.fill(data.services);

                if (this.first_time_execution) {
                    self.hardware.fill(data.hardware);
                    this.first_time_execution = false;
                }
            },

            gpio_table: ko.observable(),
            funcs_table: ko.observable(),
            n_pins: undefined,
            notes: {},

            // This completely draw GPIO and Funcs table since their data is not separated
            parseGPIOStatusAndFuncs(gpio_status) {
                let rows = gpio_status.rows;
                let columns = gpio_status.columns;
                let pins = gpio_status.pins;
                let compact_view = self.local_checks.compact_view();
                let hide_special = self.local_checks.hide_special_pins();
                let order_by_name = self.local_checks.order_by_name();
                let hide_physical = self.local_checks.hide_physical();
                let show_notes = self.local_checks.show_notes();
                let hide_images = self.local_checks.hide_images();

                if (columns !== 2)
                    throw "This number or columns is not possible: col=" + columns + " row=" + rows;

                this.n_pins = columns * rows;

                /* ** DATA PREPARATION ** */

                // This constraint is kept by event handlers, it is here just for insurance
                if (compact_view && (hide_special || order_by_name || show_notes)) {
                    self.local_checks.hide_special_pins(false);
                    hide_special = false;
                    self.local_checks.order_by_name(false);
                    order_by_name = false;
                    self.local_checks.show_notes(false);
                    show_notes = false;
                    self.log("Error on flags constraints");
                }

                if (order_by_name)
                    pins = self.loader.orderByName(pins);

                /* ** DATA FORMATTING ** */

                if (show_notes)
                    self.loader.notes = JSON.parse(self.gpiostatus.pins_notes_json());
                else
                    self.loader.notes = {};

                // Extract data from the JSON and format it in a matrix
                let raw_gpio_table = [];

                if (self.loader.first_time_execution) {
                    let raw_func_table = [];

                    this.extractRawTables(
                        raw_gpio_table,
                        pins,
                        compact_view,
                        hide_special,
                        hide_physical,
                        show_notes,
                        hide_images,
                        true,
                        raw_func_table
                    );

                    self.loader.funcs_table(self.format.htmlTable(raw_func_table));
                } else
                    this.extractRawTables(
                        raw_gpio_table,
                        pins,
                        compact_view,
                        hide_special,
                        hide_physical,
                        show_notes,
                        hide_images
                    );

                /* ** GPIO DATA OUTPUT ** */
                self.loader.gpio_table(self.format.htmlTable(raw_gpio_table));

                /* ** NOTES ACTIVATION ** */

                if (show_notes)
                    this.activateNotes();
            },

            orderByName(pins) {
                return pins.slice().sort(function (pin1, pin2) {
                    if (pin1.is_bcm)
                        if (pin2.is_bcm)
                            return parseInt(pin1.name.replace("GPIO", "")) >
                            parseInt(pin2.name.replace("GPIO", "")) ?
                                self.const.FIRST_GREATER : self.const.SECOND_GREATER;
                        else
                            return self.const.SECOND_GREATER;
                    if (pin2.is_bcm)
                        return self.const.FIRST_GREATER;
                    if (pin1.name === pin2.name)
                        return self.const.EQUAL;
                    return pin1.name > pin2.name ? self.const.FIRST_GREATER : self.const.SECOND_GREATER;
                });
            },

            extractRawTables(raw_gpio_table, pins, compact_view, hide_special, hide_physical,
                             show_notes, hide_images, parse_funcs = false, raw_func_table = undefined) {

                pins.forEach(function (pin) {
                    if (pin.is_bcm || !hide_special)
                        if (show_notes && (pin.physical_name in self.loader.notes))
                            raw_gpio_table.push(
                                self.loader.prepareRow(
                                    pin, hide_images, hide_physical, true, self.loader.notes[pin.physical_name]));
                        else
                            raw_gpio_table.push(self.loader.prepareRow(pin, hide_images, hide_physical, show_notes));

                    if (parse_funcs && pin.is_bcm) {
                        raw_func_table.push(Array(pin.name).concat(self.format.funcs(pin.funcs)))
                    }
                });
                if (parse_funcs)
                    raw_func_table.sort(function (pin1, pin2) {
                        return parseInt(pin1[0].substr(4)) > parseInt(pin2[0].substr(4)) ?
                            self.const.FIRST_GREATER : self.const.SECOND_GREATER;
                    });

                // Join two rows in one if compact view is enabled
                if (compact_view) {
                    let reformatted_table = [];
                    for (let i = 0; i < raw_gpio_table.length; i += 2)
                        reformatted_table.push(raw_gpio_table[i].reverse().concat(raw_gpio_table[i + 1]));

                    raw_gpio_table.length = 0;
                    raw_gpio_table.push(...reformatted_table);
                }
            },

            // This prepares a line in the form of an array, so that it only requires wrapping
            prepareRow(pin_status, hide_images, hide_physical, show_note = false, note = "") {
                let prepared = [];

                if (pin_status.is_bcm)
                    prepared = prepared.concat([
                        pin_status.name,
                        self.format.pinStatus(pin_status),
                        self.format.pull(pin_status.pull),
                        self.format.level(pin_status.current_value)
                    ]);
                else
                    prepared = prepared.concat([
                        self.format.pinName(pin_status.name),
                        "", "", ""
                    ]);

                if (show_note)
                    prepared.splice(1, 0, self.wrap.noteSpan(note, pin_status.physical_name));

                if (!hide_physical)
                    prepared.unshift(self.format.physical(pin_status.physical_name));

                if (!hide_images)
                    prepared.unshift(self.imgs.getImage(pin_status.name, pin_status.is_bcm))

                return prepared;
            },

            activateNotes() {
                for (let i = self.loader.n_pins; i > 0; i--)
                    $("#gpiostatus-note-" + i).on("input", () => {
                        let source = $("#gpiostatus-note-" + i);
                        let value = source.text().trim();

                        if (value.length === 0)
                            delete self.loader.notes[i];
                        else
                            self.loader.notes[i] = value;

                        self.notes_saver.save();
                    }).attr("contenteditable", true);
            },

            setDefault(text) {
                self.loader.gpio_table("<tr><td colspan='100%' style='text-align: center'>" + text + "</td></tr>");
                if (self.loader.first_time_execution)
                    self.loader.funcs_table("<tr><td colspan='100%' style='text-align: center'>" + text + "</td></tr>");
            }
        };

        self.wrap = {
            span(value, css_classes = "") {
                return "<span class='" + css_classes + "'>" + value + "</span>";
            },

            arrayTd(array) {
                return this.arrayWithTag(array, "td");
            },

            arrayTR(array) {
                return this.arrayWithTag(array, "tr");
            },

            arrayWithTag(array, tag) {
                return "<" + tag + ">" + array.join("</" + tag + "><" + tag + ">") + "</" + tag + ">";
            },

            noteSpan(note, pin) {
                return "<span id='gpiostatus-note-" + pin + "'>" + note + "</span>";
            }
        };

        self.imgs = {
            img5v: "<img src='/plugin/gpiostatus/static/img/5V.png' class='td_img' alt='-'>",
            img3v3: "<img src='/plugin/gpiostatus/static/img/3V3.png' class='td_img' alt='-'>",
            imgGND: "<img src='/plugin/gpiostatus/static/img/GND.png' class='td_img' alt='-'>",
            imgGPIO: "<img src='/plugin/gpiostatus/static/img/GPIO.png' class='td_img' alt='-'>",
            imgGPIO_no: "<img src='/plugin/gpiostatus/static/img/GPIO_NO.png' class='td_img' alt='-'>",
            getImage(name, is_bcm) {
                if (is_bcm)
                    return (parseInt(name.substr(4)) > 1) ? this.imgGPIO : this.imgGPIO_no;
                if (name === "GND")
                    return this.imgGND;
                if (name === "5V")
                    return this.img5v;
                return this.img3v3;
            }
        };

        self.format = {
            physical(value) {
                return self.wrap.span(value, "td_physical");
            },

            pinName(pin_name) {
                if (pin_name === "GND")
                    return self.wrap.span(pin_name, "td_gnd");
                if (pin_name === "5V")
                    return self.wrap.span(pin_name, "td_5v");
                if (pin_name === "3V3")
                    return self.wrap.span(pin_name, "td_3v3");
                return pin_name
            },

            pull(pull) {
                if (pull === "UP")
                    return self.wrap.span(pull, "td_pull_up");
                return self.wrap.span(pull, "td_pull_down");
            },

            html_level: {
                high: self.wrap.span("HIGH", "td_high"),
                low: self.wrap.span("LOW", "td_low"),
            },
            level(level) {
                return level === 1 ? this.html_level.high : this.html_level.low;
            },

            html_status: {
                in: self.wrap.span("IN", "td_in"),
                out: self.wrap.span("OUT", "td_out")
            },
            pinStatus(pin_status) {
                if (pin_status.current_func === "OUTPUT")
                    return this.html_status.out;
                if (pin_status.current_func === "INPUT")
                    return this.html_status.in;
                return pin_status.funcs[pin_status.current_func];
            },

            funcs(funcs) {
                let formatted = []

                funcs.forEach(function (func) {
                    if (func.startsWith("SPI")) {
                        formatted.push(self.wrap.span(func, 'td_spi'));
                        return;
                    }
                    if (func.startsWith("SDA1") || func.startsWith("SCL1")) {
                        formatted.push(self.wrap.span(func, 'td_i2c'));
                        return;
                    }
                    formatted.push(func);
                });

                return formatted;
            },

            htmlTable(array) {
                let wrapped = [];
                array.forEach(function (row) {
                    wrapped.push(self.wrap.arrayTd(row))
                })
                return self.wrap.arrayTR(wrapped);
            }
        };

        // This manages the notes autosave
        self.notes_saver = {
            timeout: null,

            save() {
                if (this.timeout != null)
                    clearTimeout(this.timeout);

                this.timeout = setTimeout(function () {
                    self.gpiostatus.pins_notes_json(JSON.stringify(self.loader.notes));
                    self.settings_saver.save();
                    self.notes_saver.timeout = null;
                }, self.const.NOTE_SAVE_TIMEOUT);
            }
        };

        self.services = {
            camera_status: ko.observable(),
            ssh_status: ko.observable(),
            spi_status: ko.observable(),
            i2c_status: ko.observable(),
            serial_status: ko.observable(),
            serial_hw_status: ko.observable(),
            one_wire_status: ko.observable(),
            rgpio_status: ko.observable(),

            fill(services_status) {
                this.camera_status(this.toStr(services_status.camera));
                this.ssh_status(this.toStr(services_status.ssh));
                this.spi_status(this.toStr(services_status.spi));
                this.i2c_status(this.toStr(services_status.i2c));
                this.serial_status(this.toStr(services_status.serial));
                this.serial_hw_status(this.toStr(services_status.serial_hw));
                this.one_wire_status(this.toStr(services_status.one_wire));
                this.rgpio_status(this.toStr(services_status.remote_gpio));
            },

            setDefault(text) {
                this.camera_status(text);
                this.ssh_status(text);
                this.spi_status(text);
                this.i2c_status(text);
                this.serial_status(text);
                this.serial_hw_status(text);
                this.one_wire_status(text);
                this.rgpio_status(text);
            },

            toStr(status) {
                return status ? "enabled" : "disabled";
            }
        };

        self.hardware = {
            model_value: ko.observable(),
            revision_value: ko.observable(),
            pcb_revision_value: ko.observable(),
            released_value: ko.observable(),
            manufacturer_value: ko.observable(),
            soc_value: ko.observable(),
            storage_value: ko.observable(),
            usb_value: ko.observable(),
            usb3_value: ko.observable(),
            memory_value: ko.observable(),
            eth_speed_value: ko.observable(),
            ethernet_value: ko.observable(),
            wifi_value: ko.observable(),
            bluetooth_value: ko.observable(),
            csi_value: ko.observable(),
            dsi_value: ko.observable(),

            fill(hardware) {
                this.model_value(hardware.model);
                this.revision_value(hardware.revision);
                this.pcb_revision_value(hardware.pcb_revision);
                this.released_value(hardware.released);
                this.manufacturer_value(hardware.manufacturer);
                this.soc_value(hardware.soc);
                this.storage_value(hardware.storage);
                this.usb_value(this.addPortOrPorts(hardware.usb));
                this.usb3_value(this.addPortOrPorts(hardware.usb3));
                this.memory_value(hardware.memory + "MB");
                this.eth_speed_value(hardware.eth_speed + "Mbps");
                this.ethernet_value(this.addPortOrPorts(hardware.ethernet));
                this.wifi_value(this.getAvailableString(hardware.wifi));
                this.bluetooth_value(this.getAvailableString(hardware.bluetooth));
                this.csi_value(this.getAvailableString(hardware.csi));
                this.dsi_value(this.getAvailableString(hardware.dsi));
            },

            setDefault(text) {
                this.model_value(text);
                this.revision_value(text);
                this.pcb_revision_value(text);
                this.released_value(text);
                this.manufacturer_value(text);
                this.soc_value(text);
                this.storage_value(text);
                this.usb_value(text);
                this.usb3_value(text);
                this.memory_value(text);
                this.eth_speed_value(text);
                this.ethernet_value(text);
                this.wifi_value(text);
                this.bluetooth_value(text);
                this.csi_value(text);
                this.dsi_value(text);
            },

            addPortOrPorts(n) {
                return n + " port" + (n === 1 ? "" : "s");
            },

            getAvailableString(flag) {
                return flag ? "Available" : "Unavailable";
            }
        };

        self.setTextAllOutput = function (text) {
            self.last_time.setDefault(text);
            self.loader.setDefault(text);

            self.services.setDefault(text);
            if (self.loader.first_time_execution)
                self.hardware.setDefault(text);
        };

        self.notification = {
            content: ko.observable(),

            set_commands_unavailable(commands) {
                let config = !commands.raspi_config;
                let gpio = !config.raspi_gpio;

                if (config && gpio)
                    self.notification.content(
                        "<h4>Commands <i>raspi-config</i> and <i>raspi-gpio</i> not found. " +
                        "Please install these two to the Raspberry</h4>"
                    )
                else
                    self.notification.content(
                        "<h4>Command <i>raspi-" + (config ? "config" : "gpio") + "</i> not found. " +
                        "Please install this on to Raspberry</h4>"
                    )
                self.setTextAllOutput("Failed to retrieve");
            }
        };

        self.autosave_s = ko.observable(
            ((self.const.WAIT_TIME_BEFORE_SAVING + self.const.NOTE_SAVE_TIMEOUT) / 1000.0).toFixed(1)
        );

        self.log = function (text) {
            if (GPIOSTATUS_ENABLE_CLIENT_DEBUG_LOGS)
                console.log(text);
        }

        self.onStartupComplete = function () {
            self.local_checks.activateAutomaticLocalToServerSaving();

            if (self.gpiostatus.load_on_startup()) {
                self.refresh();
                return
            }
            self.setTextAllOutput("Waiting to click refresh button");
        };

        function easterEgg() {
            console.log("You found an Easter egg");
        }
    }

    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: GPIOStatusViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: ["settingsViewModel"],
        // Elements to bind to, e.g. #settings_plugin_gpiostatus, #tab_plugin_gpiostatus, ...
        elements: ["#tab_plugin_gpiostatus", "#settings_plugin_gpiostatus"]
    });
})
;
