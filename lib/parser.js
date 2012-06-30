var name_unpack = require('./fields').name_unpack;
var ipaddr = require('./ipaddr');

var QTYPE_STATE = {
  1: "A_UNPACK",
  5: "CNAME_UNPACK",
};

Buffer.prototype.toByteArray = function () {
  var arr = [], i;
  for (i = 0; i < this.length; i++) {
    arr.push(this.readUInt8(i));
  }
  return arr;
};

var Parser = module.exports = function (msg) {
  var state,
      len,
      pos,
      val,
      rdata_len,
      rdata,
      section,
      count;

  var packet = {};
  packet.header = {};
  packet.question = [];
  packet.answer = [];
  packet.authority = [];
  packet.additional = [];

  pos = label_pos = 0;
  state = "HEADER_ID";

  len = msg.length;

  while (pos <= len) {
    switch (state) {
      case "HEADER_ID":
        packet.header.id = msg.readUInt16BE(pos);
        pos += 2;
        state = "HEADER_BITFIELDS";
        break;
      case "HEADER_BITFIELDS":
        val = msg.readUInt16BE(pos);
        pos += 2;
        packet.header.qr = (val & 0x8000) >> 15;
        packet.header.opcode = (val & 0x7800) >> 11;
        packet.header.aa = (val & 0x400) >> 10;
        packet.header.tc = (val & 0x200) >> 9;
        packet.header.rd = (val & 0x100) >> 8;
        packet.header.ra = (val & 0x80) >> 7;
        packet.header.res1 = (val & 0x40) >> 6;
        packet.header.res2 = (val & 0x20) >> 5;
        packet.header.res3 = (val & 0x10) >> 4;
        packet.header.rcode = (val & 0xF);
        state = "HEADER_COUNT";
        break;
      case "HEADER_COUNT":
        packet.header.qdcount = msg.readUInt16BE(pos);
        pos += 2;
        packet.header.ancount = msg.readUInt16BE(pos);
        pos += 2;
        packet.header.nscount = msg.readUInt16BE(pos);
        pos += 2;
        packet.header.arcount = msg.readUInt16BE(pos);
        pos += 2;
        state = "QUESTION";
        break;
      case "QUESTION":
        val = name_unpack(msg, pos)
        pos += val.read;
        val = { name: val.value };
        val.type = msg.readUInt16BE(pos);
        pos += 2;
        val.class = msg.readUInt16BE(pos);
        pos += 2;
        packet.question.push(val);
        // TODO handle qdcount > 0 in practice no one sends this
        state = "RESOURCE_RECORD";
        section = "answer";
        count = "ancount";
        break;
      case "RESOURCE_RECORD":
        if (packet.header[count] === packet[section].length) {
          switch (section) {
            case "answer":
              section = "authority";
              count = "nscount";
              break;
            case "authority":
              section = "additional";
              count = "arcount";
              break;
            case "additional":
              state = "END";
              break;
          }
        } else {
          state = "RR_UNPACK";
        }
        break;
      case "RR_UNPACK":
        val = name_unpack(msg, pos);
        pos += val.read;
        val = { name: val.value };
        val.type = msg.readUInt16BE(pos);
        pos += 2;
        val.class = msg.readUInt16BE(pos);
        pos += 2;
        val.ttl = msg.readUInt32BE(pos);
        pos += 4;
        rdata_len = msg.readUInt16BE(pos);
        pos += 2;
        rdata = new Buffer(rdata_len);
        msg.copy(rdata, 0, pos, pos + rdata_len);
        pos += rdata_len;
        state = QTYPE_STATE[val.type]
        if (!state)
          state = "RESOURCE_DONE";
        break;
      case "RESOURCE_DONE":
        packet[section].push(val);
        state = "RESOURCE_RECORD";
        break;
      case "A_UNPACK":
        val.address = new ipaddr.IPv4(rdata.toByteArray())
        val.address = val.address.toString();
        state = "RESOURCE_DONE";
        break;
      case "CNAME_UNPACK":
        val.data = name_unpack(msg, pos - rdata_len).value;
        state = "RESOURCE_DONE";
        break;
      case "END":
        return packet;
        break;
      default:
        console.log("wtf no state");
        throw new Error("WTF no state");
        break;
    }
  };
};